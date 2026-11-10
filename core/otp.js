/* OTP boxes shared by the customer, driver, join and office pages.
   - The phone keyboard (Gboard etc.) or a paste can put the whole code into ONE box: it is spread over all boxes.
   - When every box is filled, done(code) runs once (auto sign-in). A new edit allows it again.
   - VCTOTP.fill(boxes, code) is used by the Android app when it reads the SMS itself (with the customer's Allow).
   - VCTOTP.code(text) finds the code in an SMS text. */
(function(){
  const digits=s=>String(s==null?'':s).replace(/\D/g,'');
  function bind(ins,n,done,onEdit){
    let fired='';
    const val=()=>ins.map(i=>i.value).join('');
    const check=()=>{const v=val();if(onEdit)onEdit(v);if(v.length===n&&v!==fired){fired=v;try{done(v)}catch(e){console.error(e)}}else if(v.length!==n)fired=''};
    const spread=(from,d)=>{d=d.slice(0,n);if(d.length>=n)from=0;for(let j=0;j<d.length&&from+j<n;j++)ins[from+j].value=d[j];const last=Math.min(n-1,from+d.length);(ins[last]||ins[n-1]).focus()};
    ins.forEach((inp,i)=>{
      inp.setAttribute('maxlength',String(n)); // a keyboard suggestion must fit in whole; we trim it below
      inp.oninput=()=>{const d=digits(inp.value);
        if(d.length>1){inp.value='';spread(i,d)}
        else{inp.value=d;if(d&&ins[i+1])ins[i+1].focus()}
        check()};
      inp.onpaste=e=>{const d=digits((e.clipboardData||window.clipboardData).getData('text'));if(d.length>1){e.preventDefault();spread(i,d);check()}};
      inp.onkeydown=e=>{if(e.key==='Backspace'&&!inp.value&&ins[i-1]){ins[i-1].focus();ins[i-1].value='';check();e.preventDefault()}};
    });
    return {val,reset(){ins.forEach(x=>x.value='');fired='';ins[0]&&ins[0].focus()}};
  }
  function fill(ins,code){const d=digits(code);if(!ins.length||d.length!==ins.length||!ins[0].isConnected)return false;
    ins.forEach((x,j)=>x.value=d[j]);ins[ins.length-1].dispatchEvent(new Event('input',{bubbles:true}));return true}
  // the SMS from Firebase: "123456 is your verification code for velloretaxi.app."
  function code(text,n){n=n||6;const m=String(text||'').match(new RegExp('(?:^|\\D)(\\d{'+n+'})(?!\\d)'));return m?m[1]:null}
  // Android app (Play Store): read the OTP SMS after the person taps "Allow" (Google's SMS User Consent, native plugin SmsOtp).
  // Start it BEFORE the SMS is sent. Resolves the code, or null: not the app / older app version / denied / 5-minute timeout.
  function nat(){const C=window.Capacitor;
    try{if(!(C&&C.isNativePlatform&&C.isNativePlatform()&&typeof C.nativePromise==='function'))return null}catch(e){return null}
    return C.nativePromise('SmsOtp','start',{}).then(r=>{const m=r&&typeof r.code==='string'?r.code.match(/^\d{6}$/):null;return m?m[0]:null}).catch(()=>null)}
  function stop(){const C=window.Capacitor;try{if(C&&C.isNativePlatform&&C.isNativePlatform()&&typeof C.nativePromise==='function')C.nativePromise('SmsOtp','stop',{}).catch(()=>{})}catch(e){}}
  window.VCTOTP={bind,fill,code,digits,native:nat,stop};
})();
