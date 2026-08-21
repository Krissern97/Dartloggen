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
/* En femte klasse som ikke er et ord. Vinner den, skjer det ingenting.
   Piler som treffer brettet er korte, kraftige dunk med tyngden i bunnen,
   og «bom» er et kort ord med lukkelyd og mørk vokal — etter at styrken er
   fjernet ligner de mer enn man skulle tro. Å skru opp terskelen rammer
   ekte «bom» like hardt; å gi dunket sin egen fasit rammer bare dunket.
   Helt frivillig: er den tom, oppfører alt seg som før.                  */
const NOISE = "pilkast";
const ALL = WORDS.concat([NOISE]);
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
/* ---- romfilter ----
   Nuller ut alt som ligger nær rommets eget nivå, bånd for bånd. Det som
   står igjen er bare det som faktisk stikker opp av romlyden.

   Gulvet regnes ut av snutten selv, per bånd, så det virker likt på en
   fasit og på et vindu fra strømmen — ellers ville de to blitt behandlet
   ulikt og sluttet å ligne hverandre. Terskel 0 slår det helt av.      */
function denoise(strip){
  const t = cfg.nfloor || 0;
  if(t <= 0) return strip;
  const n = strip.length;
  if(n < 4) return strip;
  const gulv = new Float32Array(B);
  const kol = new Float32Array(n);
  for(let b=0;b<B;b++){
    for(let i=0;i<n;i++) kol[i]=strip[i][b];
    const sortert = Array.prototype.slice.call(kol).sort((x,y)=>x-y);
    gulv[b] = sortert[Math.floor(n*0.10)];
  }
  return strip.map(f=>{
    const v = new Float32Array(B);
    for(let b=0;b<B;b++){
      const grense = gulv[b] + t;
      v[b] = f[b] < grense ? grense : f[b];
    }
    return v;
  });
}
function shape(strip){
  strip = denoise(strip);
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
  /* Forløpskurven ble prøvd som en del av beskrivelsen og forkastet. Når
     en hvilken som helst lyd passerer gjennom vinduet, stiger og faller
     nivået — lyden kommer inn, fyller vinduet, går ut. ALLE lyder gir den
     samme pukkelen. Kurven ga derfor omtrent lik poengsum til alle ordene
     samtidig som den fortrengte det som faktisk skiller dem, og valget ble
     tilfeldig. Styrken hører hjemme i terskelen, ikke i formen.        */
  let ss=0;
  for(let i=0;i<flat.length;i++) ss += flat[i]*flat[i];
  const norm = Math.sqrt(ss) || 1;
  for(let i=0;i<flat.length;i++) flat[i] /= norm;
  return flat;
}
/* Samme rensing, men holdt som en REKKE rammer i stedet for én lang
   vektor. Da kan DTW gå gjennom dem og strekke tiden ulikt underveis.
   Hver ramme normaliseres for seg: styrken vekk, lengden vekk, bare
   retningen igjen — så avstanden mellom to rammer er ren formforskjell. */
function shapeFrames(strip){
  strip = denoise(strip);
  // hvor mye lyd hver ramme har, målt mot snuttens eget stille og høyeste
  const en=strip.map(f=>{ let s=0; for(let b=0;b<B;b++) s+=f[b]; return s/B; });
  const sortert=en.slice().sort((x,y)=>x-y);
  const gulv=sortert[Math.floor(en.length*0.15)];
  const topp=sortert[en.length-1];
  const spenn=Math.max(1, topp-gulv);
  return strip.map((f,i)=>{
    const v=new Float32Array(B);
    let m=0;
    for(let b=0;b<B;b++) m+=f[b];
    m/=B;
    let ss=0;
    for(let b=0;b<B;b++){ v[b]=f[b]-m; ss+=v[b]*v[b]; }
    const n=Math.sqrt(ss)||1;
    for(let b=0;b<B;b++) v[b]/=n;
    /* Retningen sier hva slags lyd det er, vekten sier hvor mye den betyr.
       Uten vekten teller en ramme romstillhet like mye som en ramme full
       stemme — og for et pilnedslag, som er én kraftig ramme og tjue nesten
       stille, blir det tjue lodd av ren tilfeldighet per sammenligning. */
    return { v, w: Math.max(0.02, Math.min(1, (en[i]-gulv)/spenn)) };
  });
}
/* DTW på formrammer. Kostnaden mellom to rammer er 1 minus prikkproduktet
   — 0 er identisk form, 2 er stikk motsatt. Båndet hindrer at én ramme får
   dekke et halvt ord for å presse fram en likhet som ikke er der.
   Returnerer 0..1 der 0 er perfekt, så den kan gjøres om til «likhet». */
function dtwShape(A, B2, bandFrac){
  const n=A.length, m=B2.length;
  if(!n || !m) return 1;
  const band=Math.max(Math.abs(n-m)+1, Math.ceil((bandFrac||0.25)*Math.max(n,m)));
  /* Vektene følger den samme veien som kostnaden, i et parallelt regnskap.
     Til slutt deles kostnad på vekt, ikke på antall ruter — ellers ville en
     sammenligning full av stillhet fått lav kostnad nettopp fordi den ikke
     inneholdt noe, og sett ut som et godt treff. */
  let pC=new Float64Array(m+1).fill(Infinity), cC=new Float64Array(m+1);
  let pW=new Float64Array(m+1), cW=new Float64Array(m+1);
  pC[0]=0;
  for(let i=1;i<=n;i++){
    cC.fill(Infinity); cW.fill(0);
    const jLo=Math.max(1,i-band), jHi=Math.min(m,i+band);
    const a=A[i-1];
    for(let j=jLo;j<=jHi;j++){
      const b=B2[j-1];
      let d=0;
      for(let k=0;k<B;k++) d += a.v[k]*b.v[k];
      /* Samme balanse som i prikkproduktet: formforskjellen vektes med hvor
         mye lyd rammene har, mens forskjellen i selve styrken teller uansett
         — det er nettopp der stillheten etter et dunk skiller seg fra halen
         i et ord.  Begge ledd ligger i 0..2, så «env» er en ren andel. */
      const vekt=(a.w+b.w)/2;
      let best=pC[j], bw=pW[j];
      if(cC[j-1]<best){ best=cC[j-1]; bw=cW[j-1]; }
      if(pC[j-1]<best){ best=pC[j-1]; bw=pW[j-1]; }
      cC[j]=vekt*(1-d)+best;
      cW[j]=vekt+bw;
    }
    let t=pC; pC=cC; cC=t;
    t=pW; pW=cW; cW=t;
  }
  if(!isFinite(pC[m]) || pW[m]<=0) return 1;
  return Math.max(0, Math.min(1, pC[m]/pW[m]));
}
// Begge er enhetsvektorer, så dette ER likheten. -1 til 1.
function likhet(a, b){
  // Ulik lengde er ikke «litt likt», det er ikke sammenlignbart. Uten denne
  // vakten leser løkka forbi enden og gir NaN uten at noen merker det.
  if(!a || !b || a.length !== b.length) return -1;
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
  ALL.forEach(w=>out[w]=[]);
  try{
    const raw=JSON.parse(localStorage.getItem(KEY));
    if(raw) ALL.forEach(w=>{
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
    ALL.forEach(w=>{
      out[w]=(bank[w]||[]).map(t=>({ m:pack(t.strip), a:t.a, b:t.b }));
    });
    localStorage.setItem(KEY, JSON.stringify(out));
    return true;
  }catch(e){ return false; }
}

/* Fasitene gjøres klare én gang: klipp etter grensene dine, strekk til 40
/* Hvor kraftig ordet ble sagt da det ble lest inn, målt mot snuttens eget
   stille. Det er dette som gjør terskelen til noe annet enn en gjetning. */
function stripLevel(strip, a, b){
  const en=[];
  for(let i=0;i<strip.length;i++){
    let s=0;
    for(let k=0;k<B;k++) s += strip[i][k];
    en.push(s/B);
  }
  const sortert=en.slice().sort((x,y)=>x-y);
  const gulv=sortert[Math.floor(en.length*0.15)];
  let topp=-Infinity;
  for(let i=a;i<b && i<en.length;i++) if(en[i]>topp) topp=en[i];
  return Math.max(0, topp-gulv);
}
// Medianen, ikke snittet: ett skjevt opptak skal ikke flytte terskelen.
function refLevel(templates){
  const v=(templates||[]).map(t=>t.lvl).filter(x=>x>0).sort((a,b)=>a-b);
  if(!v.length) return 6;                 // ingen fasit ennå: noe rimelig
  return v[Math.floor(v.length/2)];
}
function prep(bank){
  const ut=[];
  ALL.forEach(w=>{
    (bank[w]||[]).forEach((t,i)=>{
      const seg=t.strip.slice(t.a, t.b);
      if(seg.length < 5) return;
      ut.push({ word:w, idx:i, len:seg.length,
                lvl: stripLevel(t.strip, t.a, t.b),
                vec: shape(resample(seg, NF)),   // til det raske prikkproduktet
                seq: shapeFrames(seg) });        // til DTW, i sin egen lengde
    });
  });
  return ut;
}

/* ---- innstillinger ---- */
function loadCfg(){
  try{ return JSON.parse(localStorage.getItem(CFGKEY)) || {}; }catch(e){ return {}; }
}
// v må stå til 0 her: standardene legges FØRST, så det lagrede oppå. Sto den
// til 2, ville en gammel innstilling uten merke arvet 2 og migreringen aldri
// fyrt — den ville sett ny ut uten å være det.
const cfg = Object.assign({ sim:0.90, gate:0.45, mute:30, nfloor:0, ns:true, dtw:false, v:0 }, loadCfg());
/* «gate» betydde før et absolutt tall, nå er det en andel av dine egne
   opptak. En lagret verdi fra før ville betydd noe helt annet. */
if(cfg.v !== 2){ cfg.gate=0.45; cfg.v=2; delete cfg.env; saveCfg(); }
function saveCfg(){
  try{ localStorage.setItem(CFGKEY, JSON.stringify(cfg)); }catch(e){}
}
const CONTROLS = [
  { key:"sim", min:0.50, max:0.99, step:0.01,
    lab:"Hvor lik formen må være",
    vis:v=>Math.round(v*100)+" %",
    note:"Måles mot hver fasit hele tiden. Se på søylene under mens du snakker: legg terskelen over det rommet klarer på egen hånd, men under det ordene dine treffer." },
  { key:"gate", min:0.15, max:1.2, step:0.01,
    lab:"Hvor høyt det må sies, mot dine egne opptak",
    vis:v=>Math.round(v*100)+" %",
    note:"Andel av nivået i fasitene dine. Du snakket med en viss kraft da du leste inn, og det er et ekte holdepunkt for hva «et ord» høres ut som — mye bedre enn et tall tatt ut av lufta. 100 % krever like høyt som da du leste inn; lavere gir slingringsmonn for avstand til mikrofonen. Under denne sammenlignes det ikke i det hele tatt." },
  { key:"nfloor", min:0, max:8, step:0.1,
    lab:"Nuller ut alt nærmere romlyden enn dette",
    vis:v=>v<=0 ? "av" : "+"+v.toFixed(1).replace(".",","),
    note:"Bånd for bånd: alt som ligger under romnivået pluss dette settes likt, så det ikke lenger bidrar med noe mønster. Rydder bort viften og gata før sammenligningen. For høyt spiser det svake konsonanter — f-en i «treff». «Av» lar alt være med." },
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
  let sporer=false, topp=-1, toppOrd=null, toppSkala=1, toppRaw=null;
  let under=0, ned=0, mute=0;
  const NED = 0.015;   // hvor mye under toppen som regnes som «den har snudd»
  const MAXWIN = Math.round(NF*SCALES[SCALES.length-1]);
  const ref = refLevel(templates);
  const krav = ref * cfg.gate;
  const siste = { sim:{}, over:0, floor:0, ref, krav };
  ALL.forEach(w=>siste.sim[w]=-1);

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

      ALL.forEach(w=>siste.sim[w] = -1);
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
      /* Terskelen er en betingelse for å BEGYNNE å se etter, ikke noe som
         får avbryte et funn. Nivået faller alltid når ordet slutter, så å
         kaste toppen her betydde at et høyt krav drepte ordet før formen
         rakk å snu — og da jobbet de to innstillingene mot hverandre i
         stedet for sammen. Faller nivået mens vi sporer, er ordet ferdig:
         da fyrer vi av det vi har funnet.                              */
      if(maxOver < ref*cfg.gate){
        if(!sporer) return null;
        return fyrAv();
      }

      let beste=-1, besteOrd=null, besteSkala=1, besteRaw=null;
      for(let s=0;s<SCALES.length;s++){
        const L = Math.round(NF*SCALES[s]);
        if(ring.length < L) continue;
        const raa = ring.slice(ring.length-L);
        const vindu = shape(resample(raa, NF));
        for(let t=0;t<templates.length;t++){
          const sim = likhet(vindu, templates[t].vec);
          const w = templates[t].word;
          if(sim > siste.sim[w]) siste.sim[w] = sim;
          if(sim > beste){ beste=sim; besteOrd=w; besteSkala=SCALES[s]; besteRaw=raa; }
        }
      }

      /* Å vente til likheten faller under terskelen er unødig sent: da kan
         den ha ligget høyt en stund etter at ordet var ferdig. Det holder å
         se at kurven har SNUDD — og det skjer straks ordet glir ut av
         vinduet, uansett hvor stille det er i rommet. Ingen stillhet kreves
         noe sted; toppen er identifiserbar først når man har passert den,
         og det er alt vi venter på. */
      if(beste >= cfg.sim){
        sporer = true; under = 0;
        if(beste > topp){
          topp=beste; toppOrd=besteOrd; toppSkala=besteSkala; toppRaw=besteRaw; ned=0;
        } else if(beste < topp - NED) ned++;
        else ned=0;
        if(ned < 3) return null;
      } else {
        if(!sporer) return null;
        // falt helt under — vent tre rammer så en enkelt dupp ikke avslutter
        if(++under < 3) return null;
      }
      return fyrAv();
    }
  };

  function fyrAv(){
      const svar = { word:toppOrd, word2Vis:toppOrd, sim:topp, skala:toppSkala,
                     ms:Math.round(NF*toppSkala*10), maate:"form" };
      /* DTW gjør det samme valget om igjen, men får strekke tiden ULIKT
         gjennom ordet. Det koster for mye å gjøre 100 ganger i sekundet, men
         én gang per ord er ingenting — så prikkproduktet finner NÅR, og DTW
         velger HVA.  */
      if(cfg.dtw && toppRaw && templates.length){
        const probe=shapeFrames(toppRaw);
        let beste2=Infinity, ord2=null, nest2=Infinity;
        for(let t=0;t<templates.length;t++){
          const d=dtwShape(probe, templates[t].seq, 0.25);
          if(d<beste2){ if(templates[t].word!==ord2){ nest2=beste2; } beste2=d; ord2=templates[t].word; }
          else if(d<nest2 && templates[t].word!==ord2) nest2=d;
        }
        svar.dtwWord=ord2;
        svar.dtwSim=1-beste2;
        svar.enig = ord2===toppOrd;
        svar.word=ord2; svar.maate="dtw";
      }
      sporer=false; topp=-1; under=0; ned=0; toppRaw=null; mute = frame + cfg.mute;
      // vant pilkastet, var det ikke et ord — si fra, men ikke registrer noe
      svar.ignorert = svar.word===NOISE;
      if(onWord) onWord(svar);
      return svar;
  }
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
  NOISE, ALL, refLevel, stripLevel, denoise,
  shape, shapeFrames, dtwShape, likhet, resample, pack, unpack, load, save, prep,
  cfg, saveCfg, CONTROLS, makeMatcher
};
})();
