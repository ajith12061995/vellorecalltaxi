/* VCT core · chat between customer and driver (Firestore bookings/{id}/chat)
   Shared by the customer, driver and office apps. Plain script (globals), loaded before each app's main script.
   Uses page globals at run time only: S, L, P, ROADS, CL, F, toast, modal, c(), mapLoop. */
let CHATUNSUB=null,CHATBID=null,CHATMSGS=[],CHATSEEN=0,CHATDRAW=null;
function chatStart(bid){if(!CL||!bid||CHATBID===bid)return;chatStop();CHATBID=bid;CHATSEEN=-1;
  CHATUNSUB=F().onSnapshot(F().collection(CL.db,'bookings',bid,'chat'),s=>{
    CHATMSGS=s.docs.map(d=>d.data()).sort((a,b)=>(a.ms||0)-(b.ms||0));
    const other=CHATMSGS.filter(m=>m.from!==CHAT_ME);
    if(CHATSEEN<0)CHATSEEN=CHATDRAW?CHATMSGS.length:CHATMSGS.length-other.filter(m=>m.ms>Date.now()-6e4).length;
    if(CHATDRAW){CHATDRAW();CHATSEEN=CHATMSGS.length}
    else if(CHATMSGS.length>CHATSEEN){const last=CHATMSGS[CHATMSGS.length-1];if(last.from!==CHAT_ME){chatPing(last.text)}}
    chatDot();
  },()=>{});}
function chatStop(){if(CHATUNSUB){CHATUNSUB();CHATUNSUB=null}CHATBID=null;CHATMSGS=[];CHATSEEN=0;CHATDRAW=null}
function chatDot(){const b=document.querySelector(CHAT_BTN);if(b)b.classList.toggle('hasdot',!CHATDRAW&&CHATMSGS.length>CHATSEEN)}
function chatSend(txt){txt=(txt||'').trim().slice(0,300);if(!txt||!CHATBID)return;
  F().addDoc(F().collection(CL.db,'bookings',CHATBID,'chat'),{from:CHAT_ME,text:txt,ms:Date.now(),at:F().serverTimestamp()}).catch(e=>toast(CL.errText(e,S.lang==='ta')))}
function chatOpen(title,quick){
  modal(`<h3>${esc(title)}</h3><div class="chatlog" id="clog"></div><div class="tags" style="justify-content:flex-start">${quick.map((q,i)=>`<button class="chip" data-cq="${i}">${esc(q)}</button>`).join('')}</div>
    <div class="field" style="height:50px"><input id="cmsg" placeholder="${L('Message type பண்ணுங்க','Type a message')}" maxlength="300"><button class="linkbtn" id="csnd">${L('அனுப்பு','Send')}</button></div>`,(m)=>{
    const log=m.querySelector('#clog');
    CHATDRAW=()=>{if(!document.body.contains(log)){CHATDRAW=null;chatDot();return}
      log.innerHTML=CHATMSGS.length?CHATMSGS.map(x=>`<div class="msg ${x.from===CHAT_ME?'me':'dr'}"><span></span><small>${new Date(x.ms||Date.now()).toLocaleTimeString(S.lang==='ta'?'ta-IN':'en-IN',{hour:'numeric',minute:'2-digit'})}</small></div>`).join('')
        :`<p class="muted" style="margin:auto;font-size:13px;text-align:center">${L('Message அனுப்புங்க. Ride முடிஞ்சதும் chat மூடிடும்.','Send a message. Chat closes when the ride ends.')}</p>`;
      [...log.querySelectorAll('.msg span')].forEach((el,i)=>el.textContent=CHATMSGS[i].text);log.scrollTop=log.scrollHeight;CHATSEEN=CHATMSGS.length;chatDot()};
    m.querySelectorAll('[data-cq]').forEach(b=>b.onclick=()=>chatSend(quick[+b.dataset.cq]));
    const inp=m.querySelector('#cmsg');m.querySelector('#csnd').onclick=()=>{chatSend(inp.value);inp.value=''};inp.onkeydown=e=>{if(e.key==='Enter'){chatSend(inp.value);inp.value=''}};
    CHATDRAW();
    const iv=setInterval(()=>{if(!document.body.contains(log)){clearInterval(iv);CHATDRAW=null;chatDot()}},500);
  });
}
