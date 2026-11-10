/* A phone whose browser has "Desktop site" turned on draws the page at laptop width, so the app looks like a
   small box in the middle. The browser ignores the page's own width setting in that mode, so the app cannot
   undo it safely (zooming the page makes map taps land in the wrong place). We show how to turn it off.
   Never shown on a normal phone, in the Play Store app, or on a real laptop. */
(function(){
  function isDeskMode(){try{var sw=Math.min(screen.width,screen.height);
    // screen.width follows the way the phone is held, so a phone held sideways is not mistaken for this
    return navigator.maxTouchPoints>0&&sw>0&&sw<520&&window.innerWidth>=screen.width*1.5&&window.innerWidth>=700}catch(e){return false}}
  function show(){
    var el=document.getElementById('vct-deskmode');
    if(!isDeskMode()){if(el)el.remove();return}
    if(el||window.__vctDeskClosed)return;
    var k=window.innerWidth/screen.width; // text sized for the real screen
    el=document.createElement('div');el.id='vct-deskmode';el.setAttribute('role','alert');
    el.style.cssText='position:fixed;left:0;right:0;top:0;z-index:2147483000;background:#FFF7DB;color:#3a2f00;border-bottom:'+(2*k)+'px solid #F2D27A;font:600 '+(15*k)+'px/1.45 system-ui,sans-serif;padding:'+(12*k)+'px '+(52*k)+'px '+(12*k)+'px '+(14*k)+'px';
    var t=document.createElement('div');
    t.textContent='App சின்னதா தெரியுதா? Browser-ல "Desktop site" ON-ஆ இருக்கு. மேல ⋮ அழுத்தி "Desktop site" ✓-ஐ எடுத்துடுங்க.';
    var e=document.createElement('div');e.style.cssText='font-weight:400;margin-top:'+(4*k)+'px';
    e.textContent='App looks small? "Desktop site" is on in your browser. Tap ⋮ and untick "Desktop site".';
    var x=document.createElement('button');x.type='button';x.setAttribute('aria-label','Close');x.textContent='×';
    x.style.cssText='position:absolute;right:'+(8*k)+'px;top:'+(6*k)+'px;width:'+(36*k)+'px;height:'+(36*k)+'px;border:0;background:none;color:inherit;font:700 '+(24*k)+'px/1 system-ui,sans-serif;cursor:pointer';
    x.onclick=function(){window.__vctDeskClosed=true;el.remove()};
    el.appendChild(t);el.appendChild(e);el.appendChild(x);document.body.appendChild(el);
  }
  window.VCTDESK={is:isDeskMode};
  if(document.body)show();else document.addEventListener('DOMContentLoaded',show);
  window.addEventListener('resize',show);
})();
