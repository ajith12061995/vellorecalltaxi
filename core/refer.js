/* "Bring a driver friend": a driver's share link carries a short code for their own mobile number
   (velloretaxi.app/driver/join/?ref=CODE). The join form reads it, the office sees who referred the applicant.
   The code is only a tidy, typo-proof way to carry the number (it has a check part); it is not a secret.
   No money moves here: any referral bonus is paid by the owner from the office, as decided by the owner. */
(function(){
  var ok=function(p){return /^[6-9]\d{9}$/.test(p)};
  function code(phone10){var p=String(phone10||'').replace(/\D/g,'').slice(-10);if(!ok(p))return '';
    var n=Number(p);return n.toString(36)+('0'+(n%97).toString(36)).slice(-2)}
  function phone(c){c=String(c||'').toLowerCase();if(!/^[0-9a-z]{6,10}$/.test(c))return null;
    var n=parseInt(c.slice(0,-2),36);if(!isFinite(n))return null;var p=String(n);
    if(!ok(p)||('0'+(n%97).toString(36)).slice(-2)!==c.slice(-2))return null;return p}
  // from the page address (?ref=CODE), never the applicant's own number
  function fromUrl(search,own10){try{var c=new URLSearchParams(search||'').get('ref');var p=phone(c);return p&&p!==own10?p:null}catch(e){return null}}
  // what is saved with the application: '+91XXXXXXXXXX' or '' (bad number / own number → '')
  function clean(v,own10){var p=String(v||'').replace(/\D/g,'').slice(-10);return ok(p)&&p!==String(own10||'').replace(/\D/g,'').slice(-10)?'+91'+p:''}
  window.VCTREF={code:code,phone:phone,fromUrl:fromUrl,clean:clean};
})();
