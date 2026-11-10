/* The small weather line on the customer and driver home screens. Data: config/weather, written every 30 minutes by
   the weatherTick function (MET Norway forecast for Vellore). Only numbers and a known "kind" are used from it; the
   words are ours. No line when there is no data or it is older than 100 minutes. */
(function(){
  function line(d,now,role){
    if(!d||typeof d.at!=='number'||!isFinite(d.at)||now-d.at>100*60000||d.at-now>10*60000)return null;
    if(typeof d.t!=='number'||!isFinite(d.t)||d.t<-10||d.t>60)return null;
    var T=Math.round(d.t)+'°C',k=['rain','soon','hot','ok'].indexOf(d.kind)>=0?d.kind:'ok',heavy=d.heavy===true&&k==='rain',drv=role==='driver',ta,en;
    if(k==='rain'){var ic=heavy?'⛈':'🌧',a=heavy?'கன மழை பெய்யுது':'மழை பெய்யுது',b=heavy?'Heavy rain now':'Raining now';
      ta=ic+' '+a+' · '+T+'. '+(drv?'Booking கூடலாம். மெதுவா ஓட்டுங்க':'நனையாம taxi-ல போங்க');
      en=ic+' '+b+' · '+T+'. '+(drv?'More bookings likely. Drive slowly':'Stay dry, take a taxi')}
    else if(k==='soon'){ta='🌦 கொஞ்ச நேரத்துல மழை வரலாம் · '+T+(drv?'. Booking கூடலாம்':'');en='🌦 Rain likely soon · '+T+(drv?'. More bookings likely':'')}
    else if(k==='hot'){ta='☀️ வெயில் அதிகம் · '+T+'. '+(drv?'தண்ணி குடிங்க':'Taxi-ல சௌகரியமா போங்க');en='☀️ Very hot · '+T+'. '+(drv?'Drink water':'Ride in comfort')}
    else{ta='⛅ வேலூர் · '+T;en='⛅ Vellore · '+T}
    return {ta:ta,en:en,kind:k};
  }
  // the line's HTML (text is built above from numbers only, so nothing from the database is put into the page as HTML)
  function html(d,now,role,lang){var l=line(d,now,role);
    return '<div class="wxline'+(l?' wx-'+l.kind:'')+'" id="wx"'+(l?'':' hidden')+'>'+(l?'<span>'+l[lang==='en'?'en':'ta']+'</span><small>MET Norway</small>':'')+'</div>'}
  window.VCTWX={line:line,html:html};
})();
