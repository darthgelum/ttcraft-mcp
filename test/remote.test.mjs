import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createRemoteGateway} from '../dist/remote.js';
import {Workspace} from '../dist/workspace.js';
import {fixture} from './fixture.mjs';

let mock,backend,gateway,temp,origin,alice,bob,aliceTransport,bobTransport;
let denied=false,revoked=false;
const aliceToken='remote_access_alice_aaaaaaaaaaaaaaaaaaaa',bobToken='remote_access_bob_bbbbbbbbbbbbbbbbbbbbbb';
const refreshedAlice='remote_access_alice_rotated_aaaaaaaaaaaa',otherGrantAlice='remote_access_alice_other_grant_aaaaaa';
const otherAliceGrant=randomUUID();
const grants={alice:randomUUID(),bob:randomUUID()};
const upstream=[];
const listen=async server=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port;};
const call=async(client,name,args={})=>{const r=await client.callTool({name,arguments:args});return {...JSON.parse(r.content[0].text),isError:!!r.isError};};
before(async()=>{
 mock=await fixture();temp=await mkdtemp(join(tmpdir(),'ttcraft-remote-'));
 backend=createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);
  if(req.url==='/internal/mcp/introspect'){
   assert.equal(req.headers.authorization,'Bearer '+ 's'.repeat(40));
   const {token}=JSON.parse(body);const owner=[aliceToken,refreshedAlice,otherGrantAlice].includes(token)?'alice':token===bobToken?'bob':null;
   res.setHeader('content-type','application/json');
   res.end(JSON.stringify(!owner||revoked&&owner==='alice'?{active:false}:{active:true,subject:owner==='alice'?'101':'202',
    grant_id:token===otherGrantAlice?otherAliceGrant:grants[owner],scope:'ttcraft:tools',resource:origin+'/mcp',expires_at:Math.floor(Date.now()/1000)+600,api_token:'private-dev-token'}));return;
  }
  upstream.push({path:req.url,authorization:req.headers.authorization});
  if(denied&&req.url==='/api/dev/tables/42/connect'){res.writeHead(403,{'content-type':'application/json'});res.end('{"error":"forbidden"}');return;}
  const r=await fetch(mock.baseUrl+req.url,{method:req.method,headers:{authorization:req.headers.authorization||''},...(body.length?{body}:{}),redirect:'error'});
  res.writeHead(r.status,{'content-type':r.headers.get('content-type')||'application/json'});res.end(Buffer.from(await r.arrayBuffer()));
 });
 const api=await listen(backend);
 const reserve=createServer();origin=await listen(reserve);await new Promise(r=>reserve.close(r));
 gateway=createRemoteGateway({resource:origin+'/mcp',apiOrigin:api,introspectionUrl:api+'/internal/mcp/introspect',gatewaySecret:'s'.repeat(40),dataDir:temp});
 await new Promise(r=>gateway.http.listen(Number(new URL(origin).port),'127.0.0.1',r));
 aliceTransport=new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{authorization:'Bearer '+aliceToken}}});
 bobTransport=new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{authorization:'Bearer '+bobToken}}});
 alice=new Client({name:'remote-alice',version:'1'});bob=new Client({name:'remote-bob',version:'1'});
 await alice.connect(aliceTransport);await bob.connect(bobTransport);
});
after(async()=>{await alice?.close();await bob?.close();await gateway?.close();if(backend)await new Promise(r=>backend.close(r));await mock?.close();if(temp)await rm(temp,{recursive:true,force:true});});

test('HTTP challenge, discovery pointer, origin validation and transport initialization',async()=>{
 const r=await fetch(origin+'/mcp',{method:'POST'});assert.equal(r.status,401);assert.match(r.headers.get('www-authenticate'),/oauth-protected-resource\/mcp/);
 const bad=await fetch(origin+'/mcp',{method:'POST',headers:{origin:'https://attacker.invalid',authorization:'Bearer '+aliceToken}});assert.equal(bad.status,403);
 const tools=await alice.listTools();assert.ok(tools.tools.some(t=>t.name==='blueprint_apply'));assert.ok(tools.tools.some(t=>t.name==='files_write'));
 assert.doesNotMatch(JSON.stringify(tools),/private-dev-token|remote_access_/);
 assert.equal(tools.tools.some(t=>['auth_begin','auth_poll','auth_logout'].includes(t.name)),false,'OAuth replaces local device-login tools');
});
test('existing table tools and isolated MCP sessions',async()=>{
 assert.equal((await call(alice,'table_connect',{table_id:42})).connected,true);
 assert.equal((await call(bob,'connections_status')).tables.length,0);
 const stolen=await fetch(origin+'/mcp',{method:'POST',headers:{authorization:'Bearer '+bobToken,'mcp-session-id':aliceTransport.sessionId,
  'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:7,method:'tools/list'})});
 assert.equal(stolen.status,404,'another account cannot use the session ID');
 const r=await fetch(origin+'/mcp',{method:'GET',headers:{authorization:'Bearer '+otherGrantAlice,'mcp-session-id':aliceTransport.sessionId}});assert.equal(r.status,404,'same user in another grant cannot steal a session');
 const renewed=await fetch(origin+'/mcp',{method:'POST',headers:{authorization:'Bearer '+refreshedAlice,'mcp-session-id':aliceTransport.sessionId,
  'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:8,method:'tools/list'})});
 assert.equal(renewed.status,200,'token rotation preserves the same user/grant session');await renewed.text();
 const state=await call(alice,'objects_list');assert.equal(state.isError,false);
 assert.ok(upstream.length);assert.ok(upstream.every(r=>r.authorization==='Bearer private-dev-token'),'external OAuth tokens never go to upstream APIs');
});
test('bounded private file transfer and existing script/file tools without host filesystem access',async()=>{
 const code='function onLoad() print("remote") end';
 assert.equal((await call(alice,'files_write',{path:'/workspace/scripts/global.lua',base64:Buffer.from(code).toString('base64')})).isError,false);
 const read=await call(alice,'files_read',{path:'/workspace/scripts/global.lua'});assert.equal(Buffer.from(read.base64,'base64').toString(),code);
 assert.equal((await call(bob,'files_read',{path:'/workspace/scripts/global.lua'})).isError,true,'different user workspace');
 const applied=await call(alice,'script_write',{target:'global',file_path:'/workspace/scripts/global.lua'});assert.equal(applied.isError,false);
 assert.equal((await call(alice,'script_read',{target:'global',output_path:'/workspace/read.lua'})).output_path,'/workspace/read.lua');
 for(const path of ['/etc/passwd','/workspace/../secret','/workspace/escape/../../secret','C:\\Windows\\win.ini']) {
  assert.equal((await call(alice,'files_read',{path})).isError,true);
  assert.equal((await call(alice,'script_read',{target:'global',output_path:path})).isError,true);
 }
 const workspace=new Workspace(join(temp,'link-test'));await workspace.path('/workspace/placeholder');
 const outside=join(temp,'secret.txt');await writeFile(outside,'PRIVATE');
 try{await symlink(outside,join(workspace.root,'link'));await assert.rejects(workspace.read('/workspace/link'),/links/);}catch(e){if(e.code!=='EPERM')throw e;}
});
test('permissions are rechecked before cached reads and revocation invalidates requests',async()=>{
 denied=true;
 assert.equal((await call(alice,'objects_list')).isError,true);
 assert.equal((await call(alice,'connections_status')).tables.length,0,'cached sessions disposed after access denial');
 denied=false;assert.equal((await call(alice,'table_connect',{table_id:42})).connected,true);
 revoked=true;
 await assert.rejects(alice.listTools());
 assert.equal((await bob.listTools()).tools.length>30,true,'other users remain connected');
});
