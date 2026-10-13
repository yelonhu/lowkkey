import type { ClientPublic } from '@lowkkey/protocol';
const scopeLabel=(scope:string)=>scope==='notes:write'?'按要求写随手记':scope==='write'?'直接写入档案':'读取';
const timestamp=(value:string)=>new Date(value).toLocaleString('zh-CN');
function sourceLabel(source:string){try{return new URL(source).hostname;}catch{return '自注册客户端 · '+source;}}
export function Connections({clients,busy,onRevoke}:{clients:ClientPublic[];busy:boolean;onRevoke:(clients:ClientPublic[])=>void}){
  const groups=new Map<string,ClientPublic[]>(),revoked=clients.filter(c=>c.status==='revoked');
  for(const client of clients.filter(c=>c.status==='active')){const group=groups.get(client.name)??[];group.push(client);groups.set(client.name,group);}
  const detail=(client:ClientPublic)=><div className="client-row" key={client.id}><div><small>{client.scopes.map(scopeLabel).join(' · ')}</small><small>授权于 {timestamp(client.createdAt)}</small><small className="client-source">来源：{sourceLabel(client.source)}</small>{client.lastUsedAt&&<small>最近使用 {timestamp(client.lastUsedAt)}</small>}</div>{client.status==='active'&&<button disabled={busy} onClick={()=>onRevoke([client])}>撤销此授权</button>}</div>;
  return <>{[...groups].map(([name,group])=>{const latest=group.map(c=>c.lastUsedAt).filter((v):v is string=>!!v).sort().at(-1);return <div className="connection-group" key={name}><div className="connection-overview"><div><span>{name}</span>{latest&&<small>最近使用 {timestamp(latest)}</small>}</div><button disabled={busy} onClick={()=>onRevoke(group)}>断开全部授权（{group.length}）</button></div><details className="connection-grants"><summary>{group.length} 项授权</summary><p className="settings-hint">按客户端显示名称收纳。各次授权独立，来源见下方。</p>{group.map(detail)}</details></div>;})}{revoked.length>0&&<details className="connection-history"><summary>已撤销的连接（{revoked.length}）</summary>{revoked.map(client=><div key={client.id}><p>{client.name}</p>{detail(client)}</div>)}</details>}</>;
}
