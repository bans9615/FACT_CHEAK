// 의존성 없이 Node 18+ 만으로 동작하는 팩트체크 서버 (npm install 불필요)
const http=require("http"),fs=require("fs"),path=require("path");
const PORT=process.env.PORT||3000,PUB=path.join(__dirname,"public");
const MIME={".html":"text/html; charset=utf-8",".js":"text/javascript",".webmanifest":"application/manifest+json",".png":"image/png"};
const RSS="https://news.google.com/rss",Q="hl=ko&gl=KR&ceid=KR:ko",cache=new Map();
const dec=s=>s.replace(/<!\[CDATA\[|\]\]>/g,"").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
function parse(xml){return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m=>{
  const g=t=>{const r=m[1].match(new RegExp("<"+t+"[^>]*>([\\s\\S]*?)</"+t+">"));return r?dec(r[1]):""};
  const src=g("source");let title=g("title");if(src&&title.endsWith(" - "+src))title=title.slice(0,-(src.length+3));
  return {title,source:src||"출처 미상",link:g("link"),date:g("pubDate")}})}
async function feed(url,ttl){const c=cache.get(url);if(c&&Date.now()-c.t<ttl)return c.v;
  const r=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 factcheck-prototype"}});
  if(!r.ok)throw new Error("news "+r.status);const v=parse(await r.text());cache.set(url,{t:Date.now(),v});return v}
const keywords=t=>[...new Set(t.replace(/https?:\/\/\S+/g,"").toLowerCase().match(/[가-힣a-z0-9]{2,}/g)||[])].sort((a,b)=>b.length-a.length).slice(0,4);
async function pageTitle(u){try{const h=new URL(u).hostname;
  if(!h.includes(".")||/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(h))return "";
  const r=await fetch(u,{signal:AbortSignal.timeout(5000),headers:{"user-agent":"Mozilla/5.0"}});
  const b=(await r.text()).slice(0,200000);
  const m=b.match(/property=["']og:title["'][^>]*content=["']([^"']+)/i)||b.match(/<title[^>]*>([^<]+)/i);return m?dec(m[1]):""}catch(e){return ""}}
async function check(text){
  let t=text.slice(0,500);const u=t.match(/https?:\/\/\S+/);
  if(u&&t.replace(u[0],"").trim().length<10)t=(await pageTitle(u[0]))||t;
  const kw=keywords(t);if(kw.length<2)return {error:"내용이 너무 짧아서 비교할 수 없어요"};
  const items=await feed(`${RSS}/search?q=${encodeURIComponent(kw.join(" "))}&${Q}`,10*60*1000);
  const rel=items.slice(0,30).map(i=>{const tl=i.title.toLowerCase();
    const hit=kw.filter(k=>tl.includes(k.slice(0,Math.max(2,k.length-1)))).length;return {...i,sim:+(hit/kw.length).toFixed(2)}})
    .filter(i=>i.sim>=0.5).sort((a,b)=>b.sim-a.sim);
  const n=new Set(rel.map(i=>i.source)).size;
  return {query:kw,articles:rel.slice(0,8),publishers:n,level:n>=3?"여러 곳에서 확인됨":n==2?"두 곳에서 확인됨":n==1?"한 곳만 보도":"비슷한 기사 없음"}}
http.createServer(async(req,res)=>{
  const u=new URL(req.url,"http://x"),send=(c,o)=>{res.writeHead(c,{"content-type":"application/json; charset=utf-8"});res.end(JSON.stringify(o))};
  try{
    if(u.pathname==="/api/trending")return send(200,(await feed(`${RSS}?${Q}`,5*60*1000)).slice(0,12));
    if(u.pathname==="/api/check"&&req.method==="POST"){let b="";for await(const c of req){b+=c;if(b.length>5000)break}
      return send(200,await check(String(JSON.parse(b||"{}").text||"")))}
    const f=path.join(PUB,u.pathname==="/"?"index.html":u.pathname);
    if(!f.startsWith(PUB)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end("not found")}
    res.writeHead(200,{"content-type":MIME[path.extname(f)]||"application/octet-stream"});fs.createReadStream(f).pipe(res)
  }catch(e){send(500,{error:"뉴스 서버에 연결하지 못했어요"})}
}).listen(PORT,()=>console.log("http://localhost:"+PORT));
