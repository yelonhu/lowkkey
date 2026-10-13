export type AuthConfig={mode:string;local:boolean;google:boolean;email:boolean;aiConnection?:boolean};
export type Account={accountId:string;email:string;mode:string;timezone:string;timezoneInitialized:boolean;providers:string[];fresh:boolean;privacy:{version:string;acceptedAt:string|null}};
export async function call(path:string,body?:unknown,owner?:string){
  const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json',...(owner?{'X-Lowkkey-Account':owner}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const value=await response.json();
  if(!response.ok)throw new Error(value.code??value.error?.code??(typeof value.error==='string'?value.error:'REQUEST_FAILED'));
  return value;
}
export const errorLabel=(code:string)=>({ACCOUNT_NOT_LINKED:'此 Google 身份尚未关联原账户，请联系支持处理。',account_not_linked:'此 Google 身份尚未关联原账户，请联系支持处理。',ACCOUNT_DELETING:'账户正在清理，请稍后再试。',reauth_required:'请重新登录验证身份，再回到设置完成操作。',privacy_not_configured:'此环境尚未开放注册，请稍后再试。',access_denied:'你取消了登录。准备好后可以再试。'}[code]??'暂时未能完成，请重试。');
export function returnPath(){
  const path=new URLSearchParams(location.search).get('returnTo');
  if(path==='/#settings'||path?.startsWith('/authorize?'))return path;
  if(location.hash&&!['#Login','#consent'].includes(location.hash))return '/'+location.hash;
  return '/#next';
}
