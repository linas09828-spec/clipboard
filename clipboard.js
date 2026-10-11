/**
 * 跨设备剪贴板 - Cloudflare Workers 单文件版
 *
 * 部署步骤：
 * 1. Workers 和 Pages → 创建 Worker → 粘贴本文件 → 部署
 * 2. 左侧 KV → 创建命名空间（名字如 clipboard）
 * 3. 回到这个 Worker → 设置 → 绑定 → 添加绑定 → KV 命名空间 → 变量名填 CLIP_KV → 选刚建的命名空间 → 保存
 * 4. 设置 → 变量和机密 → 添加机密 PASSWORD（登录密码）
 * 5.（文件功能需要）R2 有存储桶的话直接复用，没有就新建一个 → 回到这个 Worker → 设置 → 绑定 → 添加绑定 → R2 存储桶 → 变量名填 CLIP_R2 → 选存储桶 → 保存
 * 6.（可选）设置 → 域和路由 → 绑定自定义域名
 *
 * 用法：电脑上粘贴文字点发送，手机上打开就是最新的一条，点复制就行
 * 文件：选文件点上传，手机上点下载；文字和文件混排，新的在前
 */

const GATE_PASSWORD = ""; // 也可直接填密码；推荐用 Cloudflare 后台的 PASSWORD 机密

async function sha256hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

const GATE_HTML = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>请登录</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background-color:#0a1410;color:#eaf3e4;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.box{background:rgba(20,36,25,.9);border:1px solid #2c5a3c;border-radius:14px;padding:34px 30px;width:320px;text-align:center}
h2{margin:0 0 8px;color:#cdea44}p{color:#8aa892;font-size:13px;margin:0 0 18px}
input{width:100%;background:#0a1410;border:1px solid #2c5a3c;border-radius:10px;color:#fff;padding:12px 14px;font-size:15px;outline:0;margin-bottom:12px;box-sizing:border-box}
button{width:100%;background:#cdea44;border:0;border-radius:10px;color:#0a1410;font-weight:700;padding:12px;font-size:15px;cursor:pointer}
.err{color:#f87171;font-size:13px;min-height:20px;margin-top:10px}</style></head><body>
<div class="box"><h2>📋 剪贴板</h2><p>私人工具，请输入密码</p>
<input id="pw" type="password" placeholder="密码" onkeydown="if(event.key==='Enter')go()">
<button onclick="go()">进入</button><div class="err" id="err"></div></div>
<script>
function go(){
  fetch("/api/gatelogin",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:document.getElementById("pw").value})})
  .then(function(r){if(r.ok)location.reload();else document.getElementById("err").textContent="密码不对，再试试";});
}
document.getElementById("pw").focus();
</script></body></html>`;

const APP_HTML = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>📋 跨设备剪贴板</title>
<style>
*{box-sizing:border-box}
body{margin:0;padding:0;color:#eaf3e4;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background-color:#0a1410;min-height:100vh}
header{text-align:center;padding:26px 20px 6px}
header h1{margin:0 0 6px;font-size:24px;color:#fff}
header p{margin:0;color:#8aa892;font-size:13px;letter-spacing:2px}
.wrap{max-width:700px;margin:0 auto;padding:16px 20px 60px}
.sendbox{background:rgba(20,36,25,.9);border:1px solid #2c5a3c;border-radius:14px;padding:16px;margin-bottom:18px}
.sendbox textarea{width:100%;min-height:110px;background:#0a1410;border:1px solid #2c5a3c;border-radius:10px;color:#fff;padding:12px 14px;font-size:15px;outline:0;resize:vertical;font-family:inherit}
.sendbox .row{display:flex;gap:10px;margin-top:12px;align-items:center}
button{cursor:pointer}
.btn{background:#cdea44;border:0;border-radius:10px;color:#0a1410;font-weight:700;padding:11px 26px;font-size:15px}
.btn:hover{background:#d8f55e}
.btn:disabled{opacity:.5}
.ghost{background:#1d3a28;color:#eaf3e4;border:1px solid #2c5a3c;border-radius:8px;padding:7px 13px;font-size:13px}
.ghost:hover{background:#274d33}
#status{font-size:13px;color:#8aa892;min-height:20px}
.clip{background:rgba(20,36,25,.7);border:1px solid #1d3a28;border-radius:12px;padding:14px 16px;margin-bottom:12px}
.clip .meta{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.clip .time{font-size:12px;color:#5b7a64}
.clip .text{font-size:14px;line-height:1.7;white-space:pre-wrap;word-break:break-all;color:#eaf3e4;max-height:120px;overflow:hidden}
.clip .text.full{max-height:none}
.clip .ops{display:flex;gap:8px;margin-top:10px}
.abtn{display:inline-block;text-decoration:none}
.empty{text-align:center;color:#5b7a64;padding:40px;font-size:14px}
</style></head><body>
<header><h1>📋 跨设备剪贴板</h1><p>电脑复制 · 手机粘贴</p></header>
<div class="wrap">
<div class="sendbox">
<textarea id="input" placeholder="粘贴文字、链接…"></textarea>
<div class="row">
<button class="btn" id="sendbtn" onclick="sendClip()">发送</button>
<button class="ghost" onclick="loadClips()">↻ 刷新</button>
<span id="status"></span>
</div>
</div>
<div class="sendbox">
<div style="font-size:14px;margin-bottom:10px;color:#cdea44">📎 文件互传 <span style="font-size:12px;color:#8aa892">建议100MB以内</span></div>
<div class="row">
<input type="file" id="fileinput" style="flex:1;color:#8aa892;font-size:13px">
<button class="btn" id="upbtn" onclick="uploadFile()">上传</button>
</div>
<div id="upbarwrap" style="display:none;height:6px;background:#0a1410;border-radius:3px;margin-top:10px;overflow:hidden"><div id="upbar" style="height:100%;width:0;background:#cdea44"></div></div>
</div>
<div id="list"></div>
</div>
<script>
var clipsData={};
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function setStatus(t){document.getElementById("status").textContent=t;}
function fmtTime(t){return new Date(t).toLocaleString("zh-CN",{hour12:false});}
function fmtSize(n){n=Number(n)||0;if(n<1024)return n+" B";if(n<1048576)return (n/1024).toFixed(1)+" KB";if(n<1073741824)return (n/1048576).toFixed(1)+" MB";return (n/1073741824).toFixed(2)+" GB";}
async function api(p,opt){
  var r=await fetch(p,opt);var d=await r.json().catch(function(){return {};});
  if(!r.ok)throw new Error(d.msg||("HTTP "+r.status));return d;
}
async function loadClips(silent){
  try{
    var d=await api("/api/clips");
    d.list.forEach(function(c){if(c.kind!=="file")clipsData[c.id]=c.text;});
    var el=document.getElementById("list");
    if(!d.list.length){el.innerHTML='<div class="empty">还没有内容，在上面粘贴一条吧</div>';return;}
    el.innerHTML=d.list.map(function(c){
      if(c.kind==="file"){
        return '<div class="clip">'
          +'<div class="meta"><span class="time">📎 '+esc(fmtTime(c.t))+' · '+esc(fmtSize(c.size))+'</span></div>'
          +'<div class="text">'+esc(c.name)+'</div>'
          +'<div class="ops"><a class="ghost abtn" href="/api/dl?id='+c.id+'">⬇ 下载</a>'
          +'<button class="ghost" data-id="'+c.id+'" data-kind="file" onclick="delClip(this)">🗑 删除</button></div></div>';
      }
      var preview=c.text.length>160;
      return '<div class="clip">'
        +'<div class="meta"><span class="time">'+esc(fmtTime(c.t))+'</span>'
        +(preview?'<button class="ghost" data-id="'+c.id+'" onclick="toggleFull(this)">展开</button>':"")
        +'</div>'
        +'<div class="text" id="text-'+c.id+'">'+esc(preview?c.text.slice(0,160)+"…":c.text)+'</div>'
        +'<div class="ops"><button class="ghost" data-id="'+c.id+'" onclick="copyClip(this)">📋 复制</button>'
        +'<button class="ghost" data-id="'+c.id+'" onclick="delClip(this)">🗑 删除</button></div></div>';
    }).join("");
  }catch(e){if(!silent)setStatus("❌ 加载失败："+e.message);}
}
function toggleFull(btn){
  var id=btn.getAttribute("data-id");
  var el=document.getElementById("text-"+id);
  if(el.classList.contains("full")){el.classList.remove("full");btn.textContent="展开";}
  else{el.textContent=clipsData[id];el.classList.add("full");btn.textContent="收起";}
}
function copyClip(btn){
  var id=btn.getAttribute("data-id");
  var t=clipsData[id]||"";
  function done(){btn.textContent="✅ 已复制";setTimeout(function(){btn.textContent="📋 复制";},1500);}
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(t).then(done).catch(function(){fallback();});
  }else fallback();
  function fallback(){
    var ta=document.createElement("textarea");ta.value=t;document.body.appendChild(ta);
    ta.select();try{document.execCommand("copy");done();}catch(e){setStatus("❌ 复制失败，请手动长按复制");}
    document.body.removeChild(ta);
  }
}
async function delClip(btn){
  var id=btn.getAttribute("data-id");
  var kind=btn.getAttribute("data-kind")||"text";
  if(!confirm("删掉这条？"))return;
  try{await api("/api/clip?id="+encodeURIComponent(id)+"&kind="+kind,{method:"DELETE"});delete clipsData[id];loadClips(true);}
  catch(e){setStatus("❌ 删除失败："+e.message);}
}
function uploadFile(){
  var inp=document.getElementById("fileinput");
  if(!inp.files||!inp.files.length){setStatus("先选个文件");return;}
  var f=inp.files[0];
  var fd=new FormData();fd.append("file",f);
  var xhr=new XMLHttpRequest();
  var wrap=document.getElementById("upbarwrap"),bar=document.getElementById("upbar");
  var btn=document.getElementById("upbtn");btn.disabled=true;
  wrap.style.display="block";bar.style.width="0%";
  xhr.open("POST","/api/file",true);
  xhr.upload.onprogress=function(e){if(e.lengthComputable){var p=Math.round(e.loaded/e.total*100);bar.style.width=p+"%";setStatus("上传中 "+p+"%");}};
  xhr.onload=function(){
    wrap.style.display="none";btn.disabled=false;
    var d={};try{d=JSON.parse(xhr.responseText);}catch(e){}
    if(xhr.status===200&&d.ok){inp.value="";setStatus("✅ 已上传");loadClips(true);}
    else setStatus("❌ 上传失败："+(d.msg||("HTTP "+xhr.status)));
  };
  xhr.onerror=function(){wrap.style.display="none";btn.disabled=false;setStatus("❌ 上传失败：网络错误");};
  xhr.send(fd);
}
async function sendClip(){
  var ta=document.getElementById("input");
  var text=ta.value;
  if(!text.trim()){setStatus("先写点内容");return;}
  var btn=document.getElementById("sendbtn");btn.disabled=true;setStatus("发送中…");
  try{
    await api("/api/clip",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:text})});
    ta.value="";setStatus("✅ 已发送");loadClips(true);
  }catch(e){setStatus("❌ 发送失败："+e.message);}
  btn.disabled=false;
}
loadClips();
// 打开页面、切回页面时刷新；手动点 ↻ 也行。不做定时轮询，省 KV 额度
document.addEventListener("visibilitychange",function(){if(!document.hidden)loadClips(true);});
window.addEventListener("focus",function(){loadClips(true);});
</script></body></html>`;

async function pruneOld(kv, r2) {
  const [lc, lf] = await Promise.all([kv.list({ prefix: "c:", limit: 1000 }), kv.list({ prefix: "f:", limit: 1000 })]);
  const all = [...lc.keys.map((k) => k.name), ...lf.keys.map((k) => k.name)].sort((a, b) =>
    a.slice(2) < b.slice(2) ? -1 : a.slice(2) > b.slice(2) ? 1 : 0
  );
  if (all.length <= 200) return;
  const olds = all.slice(0, all.length - 200);
  await Promise.all(
    olds.map(async (k) => {
      if (k.startsWith("f:") && r2) {
        const meta = await kv.get(k, "json");
        if (meta && meta.r2key) await r2.delete(meta.r2key).catch(() => {});
      }
      await kv.delete(k);
    })
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // ---- 密码门 ----
    const gatePw = (env && env.PASSWORD) || GATE_PASSWORD || "";
    if (gatePw) {
      if (url.pathname === "/api/gatelogin") {
        if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
        const body = await request.json().catch(() => ({}));
        if (body.password === gatePw) {
          const token = await sha256hex("clip|" + gatePw);
          return json({ ok: true }, 200, {
            "Set-Cookie": "clip_auth=" + token + "; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax",
          });
        }
        return json({ ok: false }, 401);
      }
      const token = await sha256hex("clip|" + gatePw);
      const cookie = request.headers.get("Cookie") || "";
      if (cookie.indexOf("clip_auth=" + token) === -1) {
        if (url.pathname === "/") {
          return new Response(GATE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
        }
        return new Response("Unauthorized", { status: 401 });
      }
    }
    const kv = env.CLIP_KV;
    if (!kv) {
      return new Response("还没绑定 KV：到这个 Worker 的 设置 → 绑定 里添加 KV 命名空间，变量名填 CLIP_KV", {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    // ---- 列表（文字+文件混排，新的在前） ----
    if (url.pathname === "/api/clips") {
      const [lc, lf] = await Promise.all([kv.list({ prefix: "c:", limit: 500 }), kv.list({ prefix: "f:", limit: 500 })]);
      const keys = [...lc.keys.map((k) => ({ key: k.name, kind: "text" })), ...lf.keys.map((k) => ({ key: k.name, kind: "file" }))];
      const items = await Promise.all(
        keys.map(async ({ key, kind }) => {
          const v = await kv.get(key, "json");
          if (!v) return null;
          if (kind === "text") return { kind, id: key.slice(2), t: v.t, text: v.text };
          return { kind, id: key.slice(2), t: v.t, name: v.name, size: v.size, type: v.type };
        })
      );
      const list = items.filter(Boolean).sort((a, b) => b.t - a.t).slice(0, 50);
      return json({ ok: true, list });
    }
    // ---- 新增文字 ----
    if (url.pathname === "/api/clip" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const text = (body.text || "").toString().slice(0, 100000);
      if (!text.trim()) return json({ ok: false, msg: "内容为空" }, 400);
      const id = Date.now().toString() + Math.random().toString(36).slice(2, 8);
      await kv.put("c:" + id, JSON.stringify({ t: Date.now(), text }));
      await pruneOld(kv, env.CLIP_R2);
      return json({ ok: true });
    }
    // ---- 上传文件 ----
    if (url.pathname === "/api/file" && request.method === "POST") {
      const r2 = env.CLIP_R2;
      if (!r2)
        return json({ ok: false, msg: "还没绑定 R2：到这个 Worker 的 设置 → 绑定 里添加 R2 存储桶，变量名填 CLIP_R2" }, 500);
      const form = await request.formData().catch(() => null);
      const file = form && form.get("file");
      if (!file || typeof file === "string") return json({ ok: false, msg: "没有收到文件" }, 400);
      const id = Date.now().toString() + Math.random().toString(36).slice(2, 8);
      const origName = (file.name || "file").toString();
      const safeName = origName.replace(/[^\w.\-()\[\] ]/g, "_").slice(0, 120) || "file";
      const r2key = "clip/" + id + "/" + safeName;
      await r2.put(r2key, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" } });
      await kv.put(
        "f:" + id,
        JSON.stringify({ kind: "file", t: Date.now(), name: origName.slice(0, 200), size: file.size, type: file.type || "", r2key })
      );
      await pruneOld(kv, r2);
      return json({ ok: true });
    }
    // ---- 下载文件 ----
    if (url.pathname === "/api/dl") {
      const r2 = env.CLIP_R2;
      const id = url.searchParams.get("id") || "";
      const meta = id && r2 ? await kv.get("f:" + id, "json") : null;
      if (!meta) return new Response("Not found", { status: 404 });
      const obj = await r2.get(meta.r2key);
      if (!obj) return new Response("Not found", { status: 404 });
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set("Content-Disposition", "attachment; filename*=UTF-8''" + encodeURIComponent(meta.name));
      return new Response(obj.body, { headers });
    }
    // ---- 删除 ----
    if (url.pathname === "/api/clip" && request.method === "DELETE") {
      const id = url.searchParams.get("id") || "";
      const kind = url.searchParams.get("kind") || "text";
      if (kind === "file") {
        const meta = id ? await kv.get("f:" + id, "json") : null;
        if (meta && meta.r2key && env.CLIP_R2) await env.CLIP_R2.delete(meta.r2key).catch(() => {});
        if (id) await kv.delete("f:" + id);
      } else if (id) {
        await kv.delete("c:" + id);
      }
      return json({ ok: true });
    }
    if (url.pathname === "/") {
      return new Response(APP_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    return new Response("Not found", { status: 404 });
  },
};
