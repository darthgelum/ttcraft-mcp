import { createServer as httpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import { safeUrl, type Config } from './config.js';
import { Workspace } from './workspace.js';

interface Identity { active: boolean; subject: string; grant_id: string; scope: string; resource: string; expires_at: number; api_token: string; }
export interface RemoteConfig { resource: string; apiOrigin: string; introspectionUrl: string; gatewaySecret: string; dataDir: string;
  maxSessions?: number; idleMs?: number; allowedOrigins?: string[]; }
type Runtime = ReturnType<typeof createServer> & { transport: StreamableHTTPServerTransport; owner: string; grant: string;
  touched: number; running: number; context: Config; tail: Promise<unknown>; };

export function createRemoteGateway(config: RemoteConfig) {
  const resource = safeUrl(config.resource), api = safeUrl(config.apiOrigin), introspection = new URL(config.introspectionUrl);
  if (api.pathname !== '/' || api.search || api.hash || resource.pathname !== '/mcp' || resource.search || resource.hash) throw new Error('Use an API origin and an absolute /mcp resource URL.');
  if (config.gatewaySecret.length < 32 || introspection.username || introspection.password
      || !['https:','http:'].includes(introspection.protocol)) throw new Error('Invalid gateway configuration.');
  const sessions = new Map<string,Runtime>();
  let opening = 0;
  const ownerOpening = new Map<string,number>();
  const max = config.maxSessions ?? 100, idleMs = config.idleMs ?? 15*60*1000;
  const origins = new Set(config.allowedOrigins ?? [resource.origin]);
  const json = (res: ServerResponse,status: number,value: unknown) => {res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
  async function identify(raw: string): Promise<Identity> {
    const response = await fetch(introspection, {method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),
      headers:{authorization:'Bearer '+config.gatewaySecret,'content-type':'application/json',accept:'application/json'},body:JSON.stringify({token:raw})});
    if (!response.ok) throw new Error('Authorization service unavailable');
    const identity = await response.json() as Identity;
    if (identity.active !== true || identity.resource !== resource.href || identity.scope !== 'ttcraft:tools'
        || !/^\d+$/.test(identity.subject) || !/^[a-f0-9-]{36}$/.test(identity.grant_id)
        || !identity.api_token || identity.expires_at*1000<=Date.now()) throw Object.assign(new Error('Unauthorized'),{status:401});
    return identity;
  }
  function dispose(id: string,r: Runtime) {sessions.delete(id);r.sessions.dispose();void r.server.close().catch(()=>{});}
  function make(identity: Identity, token: string): Runtime {
    const workspace = new Workspace(join(resolve(config.dataDir),'users',identity.subject));
    const context: Config = {baseUrl:api.origin,configDir:join(workspace.root,'.mcp'),token:identity.api_token,remote:true};
    let currentToken = token;
    let runtime: Runtime;
    const check = async () => {
      const fresh = await identify(currentToken);
      if(fresh.subject!==identity.subject||fresh.grant_id!==identity.grant_id)throw new Error('Authorization identity changed.');
      context.token = fresh.api_token;
    };
    const tableAccess = async (tableId: number) => {
      await check();
      const response = await runtime.auth.api<any>(`/api/dev/tables/${tableId}/connect`);
      const connected = (runtime.sessions.status().tables as any[]).find(s=>s.table_id===tableId && s.connected);
      if (connected && response.caps!==connected.caps) {
        runtime.sessions.close(tableId);throw new Error('Table permissions changed. Reconnect to obtain current access.');
      }
    };
    context.checkTableAccess = tableAccess;
    const core = createServer(context,{
      beforeTool: async (name,args) => {
        try {
          await check();
          if (!/^(auth_|docs_|commands_|command_describe|modules_options|modules_list|tables_list|table_disconnect|connections_status)/.test(name)) {
            const id = args.table_id ?? core.sessions.status().active_table_id;
            if (id) await tableAccess(id);
          }
        } catch (error) {core.sessions.dispose();throw error;}
      },
      arguments: async (name,args)=>workspace.arguments(name,args), output:value=>workspace.output(value),
    });
    for(const [name,description,shape,run] of [
      ['files_write','Stage a file in your private /workspace. Base64 chunks up to 1 MiB, exact append offset. Existing files are never overwritten.',
        {path:z.string(),base64:z.string().max(1400000),offset:z.number().int().min(0).default(0)},(a:any)=>workspace.write(a.path,a.base64,a.offset)],
      ['files_read','Read/download your own staged file as bounded base64 chunks.',
        {path:z.string(),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(256*1024).default(256*1024)},(a:any)=>workspace.read(a.path,a.offset,a.limit)],
    ] as const) core.server.registerTool(name,{description,inputSchema:shape,annotations:{readOnlyHint:name==='files_read',destructiveHint:false}},async (args:any)=>{
      try {await check();const value=await run(args);return {content:[{type:'text' as const,text:JSON.stringify(value)}]};}
      catch {return {isError:true,content:[{type:'text' as const,text:JSON.stringify({error:'File operation rejected. Use a private /workspace path and the documented chunk limits.'})}]};}
    });
    const transport = new StreamableHTTPServerTransport({sessionIdGenerator:randomUUID,enableJsonResponse:true,
      onsessioninitialized:id=>{sessions.set(id,runtime);}});
    runtime = {...core,transport,owner:identity.subject,grant:identity.grant_id,touched:Date.now(),running:0,context,tail:Promise.resolve()};
    // Update external access tokens on rotation while keeping the same isolated session.
    (runtime as Runtime & {update:(value:string)=>void}).update=value=>{currentToken=value;};
    core.server.server.onclose=()=>{core.sessions.dispose();if(transport.sessionId)sessions.delete(transport.sessionId);};
    return runtime;
  }
  const timer = setInterval(()=>{for(const [id,r]of sessions)if(!r.running&&Date.now()-r.touched>idleMs)dispose(id,r);},30000);
  timer.unref();
  const http = httpServer(async(req:IncomingMessage,res:ServerResponse)=>{
    res.setHeader('Cache-Control','no-store');
    const host=req.headers.host, origin=req.headers.origin;
    if(host!==resource.host || origin && !origins.has(origin)){json(res,403,{error:'Forbidden origin or host'});return;}
    if(req.url==='/health'&&req.method==='GET'){json(res,200,{ok:true});return;}
    if(req.url!=='/mcp'){json(res,404,{error:'Not found'});return;}
    if(!['GET','POST','DELETE','OPTIONS'].includes(req.method||'')){json(res,405,{error:'Method not allowed'});return;}
    if(req.method==='OPTIONS'){
      if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
      res.setHeader('Access-Control-Allow-Methods','GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id');res.writeHead(204);res.end();return;
    }
    if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Expose-Headers','MCP-Session-Id, WWW-Authenticate');res.setHeader('Vary','Origin');}
    const raw=/^Bearer ([A-Za-z0-9_-]{20,256})$/i.exec(req.headers.authorization||'')?.[1];
    const unauthorized=()=>{res.setHeader('WWW-Authenticate',`Bearer resource_metadata="${resource.origin}/.well-known/oauth-protected-resource/mcp", scope="ttcraft:tools"`);json(res,401,{error:'invalid_token'});};
    if(!raw){unauthorized();return;}
    let r:Runtime|undefined,created=false,counted=false,reservedOwner:string|undefined;
    try{
      const identity=await identify(raw);
      const sessionId=req.headers['mcp-session-id'];
      if(sessionId){
        r=typeof sessionId==='string'?sessions.get(sessionId):undefined;
        if(!r||r.owner!==identity.subject||r.grant!==identity.grant_id){json(res,404,{error:'Unknown session'});return;}
      } else {
        if(req.method!=='POST'){json(res,400,{error:'Initialize an MCP session first'});return;}
        if(sessions.size+opening>=max||[...sessions.values()].filter(s=>s.owner===identity.subject).length+(ownerOpening.get(identity.subject)||0)>=5){json(res,429,{error:'Session limit reached'});return;}
        opening++;reservedOwner=identity.subject;ownerOpening.set(identity.subject,(ownerOpening.get(identity.subject)||0)+1);
        r=make(identity,raw);created=true;await r.server.connect(r.transport);
      }
      const runtime=r;
      let body:unknown;
      if(req.method==='POST'){
        if(!req.headers['content-type']?.startsWith('application/json')){json(res,415,{error:'Expected JSON'});return;}
        let length=0;const chunks:Buffer[]=[];
        for await(const chunk of req){length+=chunk.length;if(length>2*1024*1024){json(res,413,{error:'Request too large'});return;}chunks.push(chunk);}
        try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{json(res,400,{error:'Invalid JSON'});return;}
      }
      if(created&&(!body||Array.isArray(body)||(body as any).method!=='initialize')){json(res,400,{error:'Initialize an MCP session first'});return;}
      runtime.touched=Date.now();runtime.running++;counted=true;
      const run=async()=>{
        (runtime as Runtime & {update:(value:string)=>void}).update(raw);
        runtime.context.token=identity.api_token;
        await runtime.transport.handleRequest(req,res,body);
      };
      // Serialize POST/DELETE to prevent token/context races and ambiguous table calls.
      if(req.method==='GET')await run();
      else {const next=runtime.tail.catch(()=>{}).then(run);runtime.tail=next;await next;}
      runtime.touched=Date.now();
      if(req.method==='DELETE'&&typeof sessionId==='string')dispose(sessionId,runtime);
    }catch(error){
      if(r)r.sessions.dispose();
      if(!res.headersSent){if((error as any).status===401)unauthorized();else json(res,503,{error:'MCP request could not complete'});}
      else res.end();
    }finally{
      if(reservedOwner){opening--;const n=(ownerOpening.get(reservedOwner)||1)-1;if(n)ownerOpening.set(reservedOwner,n);else ownerOpening.delete(reservedOwner);}
      if(counted&&r)r.running--;
      if(created&&r&&!r.transport.sessionId){r.sessions.dispose();void r.server.close().catch(()=>{});}
    }
  });
  http.requestTimeout=300000;http.headersTimeout=15000;
  return {http,close:async()=>{clearInterval(timer);for(const[id,r]of sessions)dispose(id,r);await new Promise<void>(resolve=>{http.close(()=>resolve());http.closeIdleConnections();});}};
}
