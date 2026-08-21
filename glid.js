/* ============================================================
   Dartloggen — glidende gjenkjenning
   ============================================================
   Et helt annet opplegg enn voice.js, bygget for å prøves mot det.

   Der bruker vi energien til å bestemme NÅR et ord begynner og slutter, og
   sammenligner så den utklipte biten. Fire av fem skyvere finnes bare for å
   få den avgjørelsen riktig, og tar den feil, er ordet tapt uansett hvor god
   fasiten er.

   Her tas den avgjørelsen aldri. En stripe av spektrogrammet skyves langs
   lyden hele tiden, og for hver 10 ms måles hvor likt formen er hver fasit.
   Blir likheten høy nok, er det et ord. Ingen startterskel å bomme på.

   «Form» er tatt bokstavelig: styrken fjernes helt før sammenligningen, så
   det er bare mønsteret som teller.
   ============================================================ */
(function(){
"use strict";

const B  = 26;            // mel-bånd, samme som voice.js
const NF = 40;            // hver fasit strekkes til 40 rammer (400 ms)
/* Sies ordet fortere eller saktere enn da du leste det inn, passer ikke en
   stripe av fast lengde. Derfor prøves flere lengder samtidig — fra 240 til
   640 ms — og den som passer best får telle. */
const SCALES = [0.6, 0.8, 1.0, 1.25, 1.6];
const WORDS = ["treff","bom","dobbel","trippel"];
const KEY = "dart_glid";
const CFGKEY = "dart_glid_cfg";

/* ---- form uten styrke ----------------------------------------------------
   Tre ledd, og hvert av dem fjerner noe som IKKE skal telle:

   1. Snittet i hver ramme. I logaritmisk skala er «dobbelt så høyt» det
      samme som «pluss en konstant i alle bånd». Trekker vi fra snittet per
      ramme, er styrken borte — nøyaktig, ikke omtrent.
   2. Snittet i hvert bånd over vinduet. Det fjerner det som er konstant
      gjennom hele ordet: mikrofonens farge, rommets klang, avstanden din.
   3. Lengden på vektoren. Da står bare retningen igjen, og prikkproduktet
      mellom to slike er likheten direkte — 1,00 er identisk form.        */
function shape(strip){
  const n = strip.length;
  const flat = new Float32Array(n*B);
  for(let i=0;i<n;i++){
    let m=0;
    for(let b=0;b<B;b++) m += strip[i][b];
    m /= B;
    for(let b=0;b<B;b++) flat[i*B+b] = strip[i][b] - m;
  }
  for(let b=0;b<B;b++){
    let m=0;
    for(let i=0;i<n;i++) m += flat[i*B+b];
    m /= n;
    for(let i=0;i<n;i++) flat[i*B+b] -= m;
  }
  let ss=0;
  for(let i=0;i<flat.length;i++) ss += flat[i]*flat[i];
  const norm = Math.sqrt(ss) || 1;
  for(let i=0;i<flat.length;i++) flat[i] /= norm;
  return flat;
}
// Begge er enhetsvektorer, så dette ER likheten. -1 til 1.
function likhet(a, b){
  let s=0;
  for(let i=0;i<a.length;i++) s += a[i]*b[i];
  return s;
}
// Strekk en stripe til n rammer, lineært mellom nabo-rammene
function resample(strip, n){
  const m = strip.length;
  if(m === n) return strip;
  const out = [];
  for(let i=0;i<n;i++){
    const p = m===1 ? 0 : i*(m-1)/(n-1);
    const a = Math.floor(p), f = p-a;
    const A = strip[a], C = strip[Math.min(m-1, a+1)];
    const v = new Float32Array(B);
    for(let k=0;k<B;k++) v[k] = A[k]*(1-f) + C[k]*f;
    out.push(v);
  }
  return out;
}

/* ---- lagring ----
   Hele stripa lagres, ikke bare det utklipte, så grensene kan flyttes
   etterpå. Én byte per verdi med 1/7 oppløsning holder rikelig.        */
function pack(strip){
  const n=strip.length, buf=new Uint8Array(n*B);
  for(let i=0;i<n;i++) for(let b=0;b<B;b++){
    const v=Math.round((strip[i][b]+25)*7);
    buf[i*B+b] = v<0?0:(v>255?255:v);
  }
  let s="";
  for(let i=0;i<buf.length;i++) s += String.fromCharCode(buf[i]);
  return btoa(s);
}
function unpack(str){
  const bin=atob(str), n=Math.floor(bin.length/B), out=[];
  for(let i=0;i<n;i++){
    const r=new Float32Array(B);
    for(let b=0;b<B;b++) r[b] = bin.charCodeAt(i*B+b)/7 - 25;
    out.push(r);
  }
  return out;
}
function load(){
  const out={};
  WORDS.forEach(w=>out[w]=[]);
  try{
    const raw=JSON.parse(localStorage.getItem(KEY));
    if(raw) WORDS.forEach(w=>{
      (raw[w]||[]).forEach(r=>{
        const strip=unpack(r.m);
        if(strip.length) out[w].push({ strip, a:r.a|0, b:r.b|0 });
      });
    });
  }catch(e){}
  return out;
}
function save(bank){
  try{
    const out={};
    WORDS.forEach(w=>{
      out[w]=(bank[w]||[]).map(t=>({ m:pack(t.strip), a:t.a, b:t.b }));
    });
    localStorage.setItem(KEY, JSON.stringify(out));
    return true;
  }catch(e){ return false; }
}

/* Fasitene gjøres klare én gang: klipp etter grensene dine, strekk til 40
   rammer, gjør om til ren form. Under spill er det bare prikkprodukter. */
function prep(bank){
  const ut=[];
  WORDS.forEach(w=>{
    (bank[w]||[]).forEach((t,i)=>{
      const seg=t.strip.slice(t.a, t.b);
      if(seg.length < 5) return;
      ut.push({ word:w, idx:i, vec:shape(resample(seg, NF)), len:seg.length });
    });
  });
  return ut;
}

/* ---- innstillinger ---- */
function loadCfg(){
  try{ return JSON.parse(localStorage.getItem(CFGKEY)) || {}; }catch(e){ return {}; }
}
const cfg = Object.assign({ sim:0.90, gate:1.5, mute:30, ns:true }, loadCfg());
function saveCfg(){
  try{ localStorage.setItem(CFGKEY, JSON.stringify(cfg)); }catch(e){}
}
const CONTROLS = [
  { key:"sim", min:0.50, max:0.99, step:0.01,
    lab:"Hvor lik formen må være",
    vis:v=>Math.round(v*100)+" %",
    note:"Måles mot hver fasit hele tiden. Se på søylene under mens du snakker: legg terskelen over det rommet klarer på egen hånd, men under det ordene dine treffer." },
  { key:"gate", min:0.2, max:6, step:0.1,
    lab:"Hvor mye lyd som må til før den ser etter",
    vis:v=>"+"+v.toFixed(1),
    note:"Eneste rest av gammel terskel. Uten den sammenlignes stillhet med ord, og ren støy treffer av og til. Grov — den trenger ikke finjustering." },
  { key:"mute", min:10, max:100, step:5,
    lab:"Sperre etter et ord",
    vis:v=>(v*10)+" ms",
    note:"Hindrer at samme ord telles to ganger mens det ebber ut." }
];

/* ---- den løpende kjennern ----
   Mates med én mel-ramme om gangen. Sier fra når et ord er sikkert nok.

   Toppen ventes av med vilje: likheten stiger mens stripa glir inn over
   ordet, er høyest når den ligger rett over, og faller igjen. Fyrer vi av
   med én gang terskelen passeres, treffer vi på vei opp — altså litt feil
   ord. Vi holder på toppen til likheten har falt tilbake.               */
function makeMatcher(templates, onWord){
  let ring=[], floor=null, n=0, frame=0;
  let sporer=false, topp=-1, toppOrd=null, toppSkala=1, under=0, mute=0;
  const MAXWIN = Math.round(NF*SCALES[SCALES.length-1]);
  const siste = { sim:{}, over:0, floor:0 };
  WORDS.forEach(w=>siste.sim[w]=-1);

  return {
    get siste(){ return siste; },
    reset(){ ring=[]; sporer=false; topp=-1; under=0; mute=0; },
    hush(f){ mute = frame + f; sporer=false; topp=-1; under=0; },
    push(mel, energy){
      frame++;
      ring.push(mel);
      if(ring.length > MAXWIN+2) ring.shift();

      // gulvet: raskt ned, tregt opp, så det legger seg på ekte stillhet
      if(floor===null){ floor=energy; n=1; }
      n++;
      if(n<40){ const a=1/n; floor = floor*(1-a) + energy*a; }
      else floor += energy>floor ? 0.004 : -0.04;
      const over = energy - floor;
      siste.over = over; siste.floor = floor;

      WORDS.forEach(w=>siste.sim[w] = -1);
      if(frame < mute) return null;
      if(!templates.length) return null;

      // ingen lyd -> ingen grunn til å regne
      let maxOver = 0;
      for(let i=Math.max(0,ring.length-NF); i<ring.length; i++){
        // energien er allerede snittet av mel-rammen
        let m=0;
        for(let b=0;b<B;b++) m += ring[i][b];
        m = m/B - floor;
        if(m > maxOver) maxOver = m;
      }
      if(maxOver < cfg.gate){
        if(sporer){ sporer=false; topp=-1; under=0; }
        return null;
      }

      let beste=-1, besteOrd=null, besteSkala=1;
      for(let s=0;s<SCALES.length;s++){
        const L = Math.round(NF*SCALES[s]);
        if(ring.length < L) continue;
        const vindu = shape(resample(ring.slice(ring.length-L), NF));
        for(let t=0;t<templates.length;t++){
          const sim = likhet(vindu, templates[t].vec);
          const w = templates[t].word;
          if(sim > siste.sim[w]) siste.sim[w] = sim;
          if(sim > beste){ beste=sim; besteOrd=w; besteSkala=SCALES[s]; }
        }
      }

      if(beste >= cfg.sim){
        sporer = true; under = 0;
        if(beste > topp){ topp=beste; toppOrd=besteOrd; toppSkala=besteSkala; }
        return null;
      }
      if(!sporer) return null;
      // falt under igjen — vent tre rammer så en enkelt dupp ikke avslutter
      if(++under < 3) return null;
      const svar = { word:toppOrd, sim:topp, skala:toppSkala,
                     ms:Math.round(NF*toppSkala*10) };
      sporer=false; topp=-1; under=0; mute = frame + cfg.mute;
      if(onWord) onWord(svar);
      return svar;
    }
  };
}

/* Innlesingen har ingen terskel i det hele tatt: den grønne skjermen varer
   nøyaktig ett sekund, og det du sier i det sekundet er opptaket. Ingenting
   å bomme på, og du kan stå der du kaster fra.                          */
const REC   = 100;   // rammer grønn skjerm = 1,00 s
const PAUSE = 70;    // rammer mellom hvert opptak
const KLAR  = 80;    // rammer «gjør deg klar» før det første

window.Glid = {
  REC, PAUSE, KLAR,
  B, NF, SCALES, WORDS, KEY, CFGKEY,
  shape, likhet, resample, pack, unpack, load, save, prep,
  cfg, saveCfg, CONTROLS, makeMatcher
};
})();
