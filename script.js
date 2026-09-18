(function(){
'use strict';

/* =========================================================================
   Bayanihan: Disaster Rescue — 3D vertical slice
   Flooded barangay, one rubber boat, eight residents, five minutes.
   ========================================================================= */

var $ = function(id){ return document.getElementById(id); };
var canvas = $('scene');

var CFG = {
  missionTime : 300,      // seconds
  capacity    : 3,        // residents per trip
  slots       : 4,        // supplies the bangka can carry
  stabilise   : 2.0,      // seconds of holding E to treat an injured resident
  radioCool   : 20,       // seconds between bearings from the MDRRMO
  riseTotal   : 1.15,     // metres the floodwater climbs over the mission
  discover    : 32,       // metres at which a signal light becomes visible
  rescueRange : 9.0,      // metres to hold alongside
  boardTime   : 0.9,      // seconds of holding E
  unloadTime  : 0.55,     // seconds per resident at the evac centre
  flareCool   : 18,
  flareShow   : 6,
  bounds      : 78,
  grid        : 23,
  cells       : 3         // -3..3  => 7x7 blocks
};

var RESIDENTS = [
  { name:'Aling Rosa, 68',    note:'retired teacher, roof of the sari-sari store',   tag:'elderly' },
  { name:'Mang Delfin, 71',   note:'tricycle driver, clinging to his awning',        tag:'elderly' },
  { name:'Jomar, 9',          note:'with his dog Bantay on the water tank',          tag:'child'   },
  { name:'Sheryl, 34',        note:'carrying a four-month-old',                      tag:'adult'   },
  { name:'Kuya Rico, 22',     note:'barangay tanod, stayed to help neighbours',      tag:'adult'   },
  { name:'Nanay Linda, 58',   note:'would not leave the store takings',              tag:'injured' },
  { name:'Tito Ben, 45',      note:'carpenter, cut a hole through his own roof',     tag:'injured' },
  { name:'Ate Mylene, 29',    note:'nurse, off shift at the district hospital',      tag:'adult'   }
];

/* Triage: higher priority is worth more and runs out sooner. Those two numbers
   are the whole lesson — you cannot save everyone, so you learn who to reach
   first. `timer` is seconds of hold before their situation worsens. */
var TAGS = {
  injured : { score: 220, timer: 118, label: 'Sugatan · Injured',     pip: 'injured' },
  elderly : { score: 170, timer: 140, label: 'Matanda · Elderly',     pip: 'elderly' },
  child   : { score: 160, timer: 152, label: 'Bata · Child',          pip: 'child'   },
  adult   : { score: 100, timer: 215, label: 'Malakas · Able-bodied', pip: 'adult'   }
};

/* Once someone is off a roof and in the current they are still savable, but
   only with the salbabida and only for this long. */
var WATER_GRACE = 58;

/* The eight things worth taking and what each one does in the water. The boat
   holds four, so packing is the real decision the game asks the player to make.
     passive  — works by being aboard
     toggle   — its number key turns it on and off
     charge   — its number key spends one of `charges`
     cooldown — its number key fires it, then waits `cooldown` seconds */
var SUPPLIES = [
  { id:'salbabida',  fil:'Salbabida',    eng:'Lifebuoy',        mode:'passive',
    fx:'Pull someone out of open water. Without it you can only pass them by.',
    tip:'Unlocks every resident already in the current.' },
  { id:'botika',     fil:'Botika',       eng:'First-aid kit',   mode:'passive',
    fx:'Stabilise an injured resident — a two-second hold — so they can board at all.',
    tip:'Injured residents score highest and have the shortest fuse.' },
  { id:'flashlight', fil:'Flashlight',   eng:'Flashlight',      mode:'toggle', defaultOn:true,
    fx:'Doubles the range at which you spot a signal light through the rain.',
    tip:'The storm is dark. Without it you will drive straight past people.' },
  { id:'lubid',      fil:'Lubid',        eng:'Rope',            mode:'passive',
    fx:'Haul residents out from behind debris and off collapsing structures.',
    tip:'Debris-pinned residents cannot be reached by hand.' },
  { id:'tubig',      fil:'Tubig',        eng:'Drinking water',  mode:'charge', charges:3,
    fx:'Three swigs. Each one refills the engine boost instantly.',
    tip:'Boost is what lets you fight the current instead of going around it.' },
  { id:'radyo',      fil:'Radyo',        eng:'Two-way radio',   mode:'cooldown', cooldown:20,
    fx:'Calls the MDRRMO for a bearing to the nearest resident you have not found.',
    tip:'The search assist. Without it the bearing needle stays dark.' },
  { id:'kapote',     fil:'Kapote',       eng:'Raincoat',        mode:'passive',
    fx:'Keeps the crew working in the downpour — residents hold on longer.',
    tip:'Buys time across the whole roster rather than saving any one person.' },
  { id:'relief',     fil:'Relief Goods', eng:'Food packs',      mode:'passive',
    fx:'+30 points for every resident delivered. Costs a slot a rescue tool could use.',
    tip:'Pure score. It never saves anyone the tools would have saved.' }
];

var SUPPLY_BY_ID = {};
SUPPLIES.forEach(function(s){ SUPPLY_BY_ID[s.id] = s; });

var RECOMMENDED = ['salbabida', 'botika', 'lubid', 'flashlight'];

/* What the player packed. Survives a retry so the report's advice can be
   acted on without repacking from scratch. */
var loadout = RECOMMENDED.slice();

function hasSupply(id){ return loadout.indexOf(id) !== -1; }

/* Runtime counters for the packed kit, rebuilt at every launch. Kept as a
   plain object so it serialises into the run record with everything else. */
function makeInventory(packed){
  var inv = { packed: packed.slice(), state: {}, used: {} };
  packed.forEach(function(id){
    var def = SUPPLY_BY_ID[id];
    if (!def) return;
    inv.state[id] = {
      on      : def.mode === 'toggle' ? !!def.defaultOn : false,
      charges : def.charges || 0,
      cd      : 0
    };
    inv.used[id] = 0;
  });
  return inv;
}

/* ---------- engine handles ---------- */
var renderer, scene, camera, clock;
var hemi, keyLight, rimLight;
var water, waterUni = { value: 0 }, waterOff = { value: null };
var rain, rainPos, rainBase;
var boatRoot, boatTilt, seatSlots = [], wakePool = [], wakeIdx = 0;
var buildings = [], debris = [], victims = [], palms = [];
var school = null, schoolBeacon = null;
var reduceMotion = false;
try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch(e){}

/* ---------- mission state ---------- */
var S = null;
var keys = {};
var lastT = 0, elapsedFrames = 0;

var TMP = { v1:null, v2:null };

/* =========================  WORLD MATHS  ========================= */

function waveAt(x, z, t){
  return Math.sin(x * 0.11 + t * 1.05) * 0.34
       + Math.sin(z * 0.15 - t * 0.85) * 0.26
       + Math.sin((x + z) * 0.052 + t * 0.55) * 0.42;
}
function waterY(x, z, t){ return waveAt(x, z, t) + (S ? S.waterLevel : 0); }
function rnd(a, b){ return a + Math.random() * (b - a); }
function pick(arr){ return arr[(Math.random() * arr.length) | 0]; }
function clamp(v, a, b){ return v < a ? a : (v > b ? b : v); }
function lerp(a, b, k){ return a + (b - a) * k; }

/* =========================  SCENE BUILD  ========================= */

function init(){
  renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1a24);
  scene.fog = new THREE.FogExp2(0x0e1a24, 0.0138);

  camera = new THREE.PerspectiveCamera(58, 1, 0.1, 620);
  camera.position.set(0, 14, 30);

  clock = new THREE.Clock();
  TMP.v1 = new THREE.Vector3();
  TMP.v2 = new THREE.Vector3();

  buildLights();
  buildWater();
  buildRain();
  buildCity();
  buildSchool();
  buildBoat();
  buildVictims();

  resize();
  window.addEventListener('resize', resize);
  bindInput();
  var nameField = $('playerName');
  if (nameField) nameField.value = cleanName(safeGet(NAME_KEY));
  markStore();
  flushPending();
  resetMission();
  requestAnimationFrame(frame);
}

function buildLights(){
  hemi = new THREE.HemisphereLight(0x64839a, 0x08131a, 0.92);
  scene.add(hemi);
  keyLight = new THREE.DirectionalLight(0xbdd6e8, 0.52);
  keyLight.position.set(-44, 62, -24);
  scene.add(keyLight);
  rimLight = new THREE.DirectionalLight(0x3d6480, 0.34);
  rimLight.position.set(36, 18, 42);
  scene.add(rimLight);
}

function buildWater(){
  var geo = new THREE.PlaneGeometry(540, 540, 128, 128);
  geo.rotateX(-Math.PI / 2);
  var mat = new THREE.MeshStandardMaterial({ color: 0x33463c, roughness: 0.28, metalness: 0.16 });
  mat.onBeforeCompile = function(sh){
    sh.uniforms.uTime = waterUni;
    sh.uniforms.uOff = waterOff;
    sh.vertexShader = 'uniform float uTime;\nuniform vec2 uOff;\nvarying float vW;\n' + sh.vertexShader;
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', [
      'vec3 transformed = vec3( position );',
      'float wx = position.x + uOff.x;',
      'float wz = position.z + uOff.y;',
      'float w = sin(wx*0.11 + uTime*1.05)*0.34',
      '       + sin(wz*0.15 - uTime*0.85)*0.26',
      '       + sin((wx+wz)*0.052 + uTime*0.55)*0.42;',
      'transformed.y += w;',
      'vW = w;'
    ].join('\n'));
    sh.fragmentShader = 'varying float vW;\n' + sh.fragmentShader;
    sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', [
      '#include <dithering_fragment>',
      'float foam = smoothstep(0.42, 0.92, vW);',
      'gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.66,0.72,0.68), foam*0.38);',
      'float murk = smoothstep(0.0, -0.7, vW);',
      'gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.12,0.17,0.15), murk*0.35);'
    ].join('\n'));
  };
  waterOff.value = new THREE.Vector2(0, 0);
  water = new THREE.Mesh(geo, mat);
  water.renderOrder = -1;
  scene.add(water);
}

function buildRain(){
  var N = reduceMotion ? 700 : 2400;
  var geo = new THREE.BufferGeometry();
  var pos = new Float32Array(N * 6);
  rainBase = new Float32Array(N * 3);
  for (var i = 0; i < N; i++){
    var x = rnd(-70, 70), y = rnd(0, 58), z = rnd(-70, 70);
    rainBase[i*3] = x; rainBase[i*3+1] = y; rainBase[i*3+2] = z;
    pos[i*6]   = x;       pos[i*6+1] = y;       pos[i*6+2] = z;
    pos[i*6+3] = x + 0.22; pos[i*6+4] = y - 1.1; pos[i*6+5] = z;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  rainPos = geo.attributes.position;
  var mat = new THREE.LineBasicMaterial({ color: 0x9dbdd2, transparent: true, opacity: 0.34 });
  rain = new THREE.LineSegments(geo, mat);
  rain.frustumCulled = false;
  scene.add(rain);
}

/* ---- barangay: concrete blocks with corrugated tin roofs ---- */
var WALL_COLORS = [0x8d8b80, 0x9b9488, 0x7d8378, 0xa39a8c, 0x86867d, 0x94897c];
var ROOF_COLORS = [0x8c4a3a, 0x3f6274, 0x6b5f4a, 0x4a6b55, 0x8a7440, 0x7a3f38];

function addBuilding(x, z, w, d, h, flatRoof){
  var g = new THREE.Group();
  var wallMat = new THREE.MeshStandardMaterial({ color: pick(WALL_COLORS), roughness: 0.95, metalness: 0.02 });
  var body = new THREE.Mesh(new THREE.BoxGeometry(w, h + 7, d), wallMat);
  body.position.y = (h + 7) / 2 - 7;   // most of it is under water
  g.add(body);

  // waterline grime band
  var grime = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.06, 1.1, d + 0.06),
    new THREE.MeshStandardMaterial({ color: 0x4a4436, roughness: 1 })
  );
  grime.position.y = 0.2;
  g.add(grime);

  var roofMat = new THREE.MeshStandardMaterial({ color: pick(ROOF_COLORS), roughness: 0.62, metalness: 0.32 });
  if (flatRoof){
    var slab = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.35, d + 0.5), roofMat);
    slab.position.y = h;
    g.add(slab);
    // parapet
    var par = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.55, 0.28), wallMat);
    par.position.set(0, h + 0.4, d / 2 + 0.22); g.add(par);
    var par2 = par.clone(); par2.position.z = -d / 2 - 0.22; g.add(par2);
  } else {
    var pitch = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, 1.9, 4), roofMat);
    pitch.position.y = h + 0.9;
    pitch.rotation.y = Math.PI / 4;
    g.add(pitch);
  }
  g.position.set(x, 0, z);
  scene.add(g);
  buildings.push({ x: x, z: z, hw: w / 2, hd: d / 2, h: h, flat: !!flatRoof, group: g });
}

function addPalm(x, z){
  var g = new THREE.Group();
  var trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.3, 7, 6),
    new THREE.MeshStandardMaterial({ color: 0x5b4b3a, roughness: 1 })
  );
  trunk.position.y = 3.2; trunk.rotation.z = rnd(-0.18, 0.18);
  g.add(trunk);
  var frondMat = new THREE.MeshStandardMaterial({ color: 0x3f5a38, roughness: 0.9, side: THREE.DoubleSide });
  for (var i = 0; i < 6; i++){
    var f = new THREE.Mesh(new THREE.ConeGeometry(0.42, 3.4, 4), frondMat);
    f.position.y = 6.6;
    f.rotation.z = rnd(0.7, 1.25);
    f.rotation.y = (i / 6) * Math.PI * 2;
    f.translateY(1.3);
    g.add(f);
  }
  g.position.set(x, -0.4, z);
  g.userData.sway = rnd(0, 6.3);
  scene.add(g);
  palms.push(g);
}

function addDebris(x, z){
  var kind = Math.random();
  var mesh, r;
  if (kind < 0.36){
    mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 1.5, 10),
      new THREE.MeshStandardMaterial({ color: pick([0x2f5f8a, 0x7a3b30, 0x4a4a44]), roughness: 0.6, metalness: 0.25 })
    );
    mesh.rotation.z = Math.PI / 2; r = 0.95;
  } else if (kind < 0.72){
    mesh = new THREE.Mesh(
      new THREE.BoxGeometry(rnd(2.4, 4.6), 0.22, rnd(0.4, 0.9)),
      new THREE.MeshStandardMaterial({ color: 0x6b5a45, roughness: 1 })
    );
    r = 1.5;
  } else {
    // corrugated tin sheet torn off a roof
    mesh = new THREE.Mesh(
      new THREE.BoxGeometry(rnd(2.0, 3.4), 0.1, rnd(1.2, 2.0)),
      new THREE.MeshStandardMaterial({ color: pick(ROOF_COLORS), roughness: 0.5, metalness: 0.45 })
    );
    r = 1.4;
  }
  mesh.position.set(x, 0, z);
  mesh.rotation.y = rnd(0, 6.28);
  scene.add(mesh);
  debris.push({ mesh: mesh, r: r, phase: rnd(0, 6.28), drift: rnd(0.15, 0.5) });
}

function buildCity(){
  var C = CFG.cells, G = CFG.grid;
  for (var gx = -C; gx <= C; gx++){
    for (var gz = -C; gz <= C; gz++){
      if (gx === 0 && gz === 0) continue;                 // evacuation centre plaza
      if (Math.random() < 0.10) continue;                 // collapsed / washed out lot
      var cx = gx * G, cz = gz * G;
      var n = Math.random() < 0.45 ? 2 : 1;
      for (var k = 0; k < n; k++){
        var ox = n === 1 ? rnd(-1.2, 1.2) : (k ? rnd(2.4, 4.0) : rnd(-4.0, -2.4));
        var oz = rnd(-1.2, 1.2);
        var w = n === 1 ? rnd(7.5, 10.5) : rnd(5, 7);
        var d = rnd(6.5, 9.5);
        var flat = Math.random() < 0.55;
        var h = flat ? rnd(3.6, 6.4) : rnd(3.2, 7.8);
        addBuilding(cx + ox, cz + oz, w, d, h, flat);
      }
      if (Math.random() < 0.3) addPalm(cx + rnd(-9, 9), cz + rnd(-9, 9));
    }
  }
  for (var i = 0; i < 46; i++){
    var a = rnd(0, 6.28), rr = rnd(12, CFG.bounds - 6);
    addDebris(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  // half-sunk jeepney as a landmark near the plaza
  var jeep = new THREE.Group();
  var jbody = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.5, 6.2),
    new THREE.MeshStandardMaterial({ color: 0xc9532f, roughness: 0.55, metalness: 0.4 }));
  jbody.position.y = 0.25; jeep.add(jbody);
  var jroof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.16, 5.0),
    new THREE.MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.7 }));
  jroof.position.y = 1.05; jeep.add(jroof);
  jeep.position.set(13.5, -0.55, 8.5); jeep.rotation.y = 0.5;
  scene.add(jeep);
  buildings.push({ x: 13.5, z: 8.5, hw: 1.6, hd: 3.3, h: 1.2, flat: false, group: jeep });
}

function makeSign(text, sub){
  var c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  var g = c.getContext('2d');
  g.fillStyle = '#123b2b'; g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#eaf3ee'; g.lineWidth = 5; g.strokeRect(9, 9, 494, 110);
  g.fillStyle = '#eaf3ee';
  g.font = '600 46px Oswald, Impact, sans-serif';
  g.textAlign = 'center';
  g.fillText(text, 256, 62);
  g.font = '500 24px "IBM Plex Mono", monospace';
  g.fillStyle = '#9fd9bd';
  g.fillText(sub, 256, 97);
  var tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

function buildSchool(){
  var g = new THREE.Group();
  var wall = new THREE.MeshStandardMaterial({ color: 0xcfcbbc, roughness: 0.92 });
  var tin  = new THREE.MeshStandardMaterial({ color: 0x3f6274, roughness: 0.5, metalness: 0.4 });

  // two-storey school block, still well above the flood
  var block = new THREE.Mesh(new THREE.BoxGeometry(26, 16, 11), wall);
  block.position.set(0, 2.4, -6.5);
  g.add(block);
  var roof = new THREE.Mesh(new THREE.BoxGeometry(27.5, 0.4, 12.5), tin);
  roof.position.set(0, 10.6, -6.5);
  g.add(roof);
  // window band
  var win = new THREE.Mesh(new THREE.BoxGeometry(23, 1.8, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x2a3a42, roughness: 0.4, emissive: 0x1a2a30, emissiveIntensity: 0.6 }));
  win.position.set(0, 7.2, -0.95); g.add(win);
  var win2 = win.clone(); win2.position.y = 3.4; g.add(win2);

  // covered court alongside — the real evacuation floor in every barangay
  var courtRoof = new THREE.Mesh(new THREE.BoxGeometry(17, 0.35, 13), tin);
  courtRoof.position.set(-20, 6.4, 3); g.add(courtRoof);
  var postMat = new THREE.MeshStandardMaterial({ color: 0xb8b3a4, roughness: 0.9 });
  for (var px = -1; px <= 1; px += 2){
    for (var pz = -1; pz <= 1; pz += 2){
      var post = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 12, 7), postMat);
      post.position.set(-20 + px * 7.6, 0.6, 3 + pz * 5.8);
      g.add(post);
    }
  }

  // concrete landing where boats tie up
  var dock = new THREE.Mesh(new THREE.BoxGeometry(18, 1.2, 5), new THREE.MeshStandardMaterial({ color: 0xa8a294, roughness: 1 }));
  dock.position.set(0, -0.55, 2.5);
  g.add(dock);

  // signage
  var sign = new THREE.Mesh(new THREE.PlaneGeometry(13, 3.25),
    new THREE.MeshBasicMaterial({ map: makeSign('EVACUATION CENTER', 'SAN ISIDRO ELEM. SCHOOL'), transparent: false }));
  sign.position.set(0, 12.4, -0.6);
  g.add(sign);
  var signBack = new THREE.Mesh(new THREE.BoxGeometry(13.4, 3.6, 0.2), new THREE.MeshStandardMaterial({ color: 0x0d2a20, roughness: 1 }));
  signBack.position.set(0, 12.4, -0.85); g.add(signBack);

  // green beacon + floodlights
  schoolBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.75, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0x57d9a8 }));
  schoolBeacon.position.set(0, 14.6, -6.5);
  g.add(schoolBeacon);
  var bl = new THREE.PointLight(0x57d9a8, 2.4, 60, 2);
  bl.position.set(0, 14.6, -6.5); g.add(bl);
  schoolBeacon.userData.light = bl;

  var fl1 = new THREE.PointLight(0xffd9a0, 1.5, 46, 2); fl1.position.set(-9, 8, 4); g.add(fl1);
  var fl2 = new THREE.PointLight(0xffd9a0, 1.5, 46, 2); fl2.position.set(9, 8, 4); g.add(fl2);

  // beam column so it reads from across the barangay
  var col = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 3.4, 40, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x57d9a8, transparent: true, opacity: 0.075, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  col.position.set(0, 20, -6.5); g.add(col);

  scene.add(g);
  school = { group: g, x: 0, z: 4.5, radius: 13 };
  buildings.push({ x: 0, z: -6.5, hw: 13.2, hd: 5.8, h: 10.6, flat: true, group: block });
}

/* =========================  BOAT  ========================= */

function buildBoat(){
  boatRoot = new THREE.Group();
  boatTilt = new THREE.Group();
  boatRoot.add(boatTilt);

  var tubeMat = new THREE.MeshStandardMaterial({ color: 0x1c2a33, roughness: 0.75 });
  var deckMat = new THREE.MeshStandardMaterial({ color: 0x6d6a5f, roughness: 0.95 });

  // side tubes
  for (var s = -1; s <= 1; s += 2){
    var tube = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 4.3, 10), tubeMat);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(s * 0.82, 0.18, 0);
    boatTilt.add(tube);
    var nose = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), tubeMat);
    nose.position.set(s * 0.82, 0.18, 2.15); boatTilt.add(nose);
    var tail = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), tubeMat);
    tail.position.set(s * 0.82, 0.18, -2.15); boatTilt.add(tail);
  }
  // bow taper
  var bow = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.7, 8), tubeMat);
  bow.rotation.x = Math.PI / 2;
  bow.position.set(0, 0.18, 2.75);
  boatTilt.add(bow);

  var deck = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 4.1), deckMat);
  deck.position.y = 0.1; boatTilt.add(deck);

  var transom = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 0.22), deckMat);
  transom.position.set(0, 0.28, -2.05); boatTilt.add(transom);

  // outboard motor
  var motor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.66, 0.5), new THREE.MeshStandardMaterial({ color: 0x23303a, roughness: 0.6, metalness: 0.3 }));
  motor.position.set(0, 0.55, -2.4); boatTilt.add(motor);
  var shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.1, 6), new THREE.MeshStandardMaterial({ color: 0x1a242b }));
  shaft.position.set(0, -0.1, -2.5); boatTilt.add(shaft);

  // rescue light bar
  var bar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.16, 0.16), new THREE.MeshStandardMaterial({ color: 0xf0a33c, emissive: 0xf0a33c, emissiveIntensity: 1.4 }));
  bar.position.set(0, 1.25, -1.2); boatTilt.add(bar);
  var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), deckMat);
  mast.position.set(0, 0.75, -1.2); boatTilt.add(mast);
  var boatLight = new THREE.PointLight(0xffc98a, 1.0, 20, 2);
  boatLight.position.set(0, 1.4, 0.4); boatTilt.add(boatLight);
  boatRoot.userData.bar = bar;

  // headlamp cone through the rain
  var beam = new THREE.Mesh(new THREE.ConeGeometry(2.6, 15, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.042, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  beam.rotation.x = -Math.PI / 2;
  beam.position.set(0, 0.9, 8.2);
  boatTilt.add(beam);

  // three seats for residents
  var seatZ = [1.15, 0.05, -1.05];
  for (var i = 0; i < 3; i++){
    var slot = new THREE.Group();
    slot.position.set(0, 0.2, seatZ[i]);
    slot.visible = false;
    boatTilt.add(slot);
    slot.add(makePerson(pick([0xd96b5a, 0x4f7fa8, 0xe0c060, 0x6fa87f]), true));
    seatSlots.push(slot);
  }

  scene.add(boatRoot);

  // wake foam pool
  var wgeo = new THREE.CircleGeometry(0.55, 10);
  wgeo.rotateX(-Math.PI / 2);
  for (var w = 0; w < 34; w++){
    var m = new THREE.Mesh(wgeo, new THREE.MeshBasicMaterial({ color: 0xcfe0d8, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false;
    scene.add(m);
    wakePool.push({ mesh: m, life: 0 });
  }
}

function makePerson(shirt, seated){
  var g = new THREE.Group();
  var body = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.24, seated ? 0.55 : 0.8, 8),
    new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 }));
  body.position.y = seated ? 0.3 : 0.42;
  g.add(body);
  var head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x8c6448, roughness: 1 }));
  head.position.y = seated ? 0.68 : 0.95;
  g.add(head);
  if (!seated){
    var arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.62, 0.1),
      new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 }));
    arm.geometry.translate(0, 0.31, 0);
    arm.position.set(0.22, 0.62, 0);
    g.add(arm);
    g.userData.arm = arm;
  }
  return g;
}

/* =========================  RESIDENTS  ========================= */

function buildVictims(){
  // Pick roofs in tiers so a stingy random layout can never leave the barangay
  // short of the eight residents the briefing promises.
  function roofPool(minFromSchool, flatOnly, hMin, hMax, maxR){
    var out = buildings.filter(function(bb){
      if (flatOnly && !bb.flat) return false;
      if (bb.h < hMin || bb.h > hMax) return false;
      if (Math.hypot(bb.x - school.x, bb.z - school.z) < minFromSchool) return false;
      if (Math.hypot(bb.x, bb.z) > maxR) return false;
      return true;
    });
    for (var i = out.length - 1; i > 0; i--){
      var j = (Math.random() * (i + 1)) | 0, t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }
  var tiers = [
    { pool: roofPool(32, true,  3.3, 6.8, CFG.bounds - 4), gap: 17 },
    { pool: roofPool(30, true,  3.3, 7.4, CFG.bounds - 3), gap: 11 },
    { pool: roofPool(26, false, 3.0, 8.2, CFG.bounds - 3), gap: 11 },
    { pool: roofPool(18, false, 2.5, 9.5, CFG.bounds),     gap: 6  }
  ];
  var chosen = [];
  for (var ti = 0; ti < tiers.length && chosen.length < RESIDENTS.length; ti++){
    var pool = tiers[ti].pool, gap = tiers[ti].gap;
    for (var p = 0; p < pool.length && chosen.length < RESIDENTS.length; p++){
      var cand = pool[p];
      if (chosen.indexOf(cand) !== -1) continue;
      var ok = true;
      for (var c = 0; c < chosen.length; c++){
        if (Math.hypot(cand.x - chosen[c].x, cand.z - chosen[c].z) < gap){ ok = false; break; }
      }
      if (ok) chosen.push(cand);
    }
  }

  for (var v = 0; v < chosen.length; v++){
    var bb = chosen[v];
    var g = new THREE.Group();
    var person = makePerson(pick([0xd96b5a, 0x4f7fa8, 0xe0c060, 0x6fa87f, 0xc07fb0]), false);
    person.position.set(rnd(-0.25, 0.25), 0, rnd(-0.25, 0.25));
    g.add(person);

    var col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.5, 34, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff5b4a, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    col.position.y = 17;
    g.add(col);
    var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xff8a5b, transparent: true, opacity: 0 }));
    lamp.position.set(0, 1.35, 0);
    g.add(lamp);

    // stand them at the roof edge facing the street
    var vx, vz;
    if (bb.hw <= bb.hd){
      vx = bb.x + (Math.random() < 0.5 ? -1 : 1) * (bb.hw - 0.55);
      vz = bb.z + rnd(-bb.hd * 0.45, bb.hd * 0.45);
    } else {
      vx = bb.x + rnd(-bb.hw * 0.45, bb.hw * 0.45);
      vz = bb.z + (Math.random() < 0.5 ? -1 : 1) * (bb.hd - 0.55);
    }
    g.position.set(vx, bb.h + 0.35, vz);
    scene.add(g);

    victims.push({
      data: RESIDENTS[v], x: vx, z: vz, roofY: bb.h + 0.35,
      group: g, person: person, col: col, lamp: lamp,
      hold: 100, known: false, aboard: false, safe: false, lost: false,
      phase: rnd(0, 6.28)
    });
  }
}

/* =========================  INPUT  ========================= */

function bindInput(){
  window.addEventListener('keydown', function(e){
    var k = e.key.toLowerCase();
    if (k === ' ') e.preventDefault();
    if (['arrowup','arrowdown','arrowleft','arrowright',' '].indexOf(k) >= 0) e.preventDefault();
    keys[k] = true;
    if (k === 'p' || k === 'escape') togglePause();
    if (k === 'q' && e.shiftKey && S && S.phase === 'run') endMission('time');
    if (k === 'r' && S && S.over) startMission();
  });
  window.addEventListener('keyup', function(e){ keys[e.key.toLowerCase()] = false; });
  window.addEventListener('blur', function(){ keys = {}; });

  var isTouch = false;
  try { isTouch = window.matchMedia('(pointer: coarse)').matches; } catch(e){}
  if (isTouch) document.body.classList.add('touch');

  var tb = document.querySelectorAll('.tbtn');
  for (var i = 0; i < tb.length; i++){
    (function(el){
      var k = el.getAttribute('data-key');
      var on = function(ev){ ev.preventDefault(); keys[k] = true; el.classList.add('on'); };
      var off = function(ev){ ev.preventDefault(); keys[k] = false; el.classList.remove('on'); };
      el.addEventListener('touchstart', on, { passive: false });
      el.addEventListener('touchend', off);
      el.addEventListener('touchcancel', off);
      el.addEventListener('mousedown', on);
      window.addEventListener('mouseup', off);
    })(tb[i]);
  }

  $('startBtn').addEventListener('click', startMission);
  $('againBtn').addEventListener('click', startMission);
  $('refreshBoard').addEventListener('click', function(){
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Loading\u2026';
    $('board').innerHTML = '<div class="empty">Reading from the database\u2026</div>';
    fetchBoard(function(err, rows){
      renderBoard(rows, lastRun);
      btn.disabled = false;
      btn.textContent = 'Load from database';
      if (err && window.console) console.warn('[bayanihan] board read failed:', err.message || err);
    });
  });
  $('resumeBtn').addEventListener('click', togglePause);
  $('abortBtn').addEventListener('click', startMission);
}

function axisThrottle(){
  var v = 0;
  if (keys['w'] || keys['arrowup']) v += 1;
  if (keys['s'] || keys['arrowdown']) v -= 0.62;
  return v;
}
function axisSteer(){
  var v = 0;
  if (keys['a'] || keys['arrowleft']) v -= 1;
  if (keys['d'] || keys['arrowright']) v += 1;
  return v;
}

/* =========================  MISSION STATE  ========================= */

function resetMission(){
  S = {
    phase: 'brief',        // brief | run | paused | over
    t: 0,
    timeLeft: CFG.missionTime,
    waterLevel: 0,
    hull: 100,
    x: 11, z: 18, yaw: 0, speed: 0,
    aboard: [],
    rescued: 0, lost: 0, capsizes: 0,
    flareCD: 0, flareT: 0,
    boardT: 0, boardTarget: null,
    unloadT: 0,
    over: false, result: null, score: 0,
    playerName: cleanName(($('playerName') || {}).value || safeGet(NAME_KEY)),
    lightning: rnd(4, 9), flashV: 0,
    distance: 0
  };
  for (var i = 0; i < victims.length; i++){
    var v = victims[i];
    v.hold = 100; v.known = false; v.aboard = false; v.safe = false; v.lost = false;
    v.group.visible = true;
    v.group.position.set(v.x, v.roofY, v.z);
  }
  for (var s = 0; s < seatSlots.length; s++) seatSlots[s].visible = false;
  boatRoot.position.set(S.x, 0.3, S.z);
  boatRoot.rotation.y = S.yaw;
  buildPips();
  syncHUD();
}

function startMission(){
  var field = $('playerName');
  if (field){
    field.value = cleanName(field.value || safeGet(NAME_KEY));
    safeSet(NAME_KEY, field.value);
  }
  resetMission();
  S.phase = 'run';
  $('briefing').hidden = true;
  $('summary').hidden = true;
  $('pause').hidden = true;
  $('hud').hidden = false;
  $('touch').hidden = false;
  toast('Unit 7 away from the evacuation centre.', 'info');
}

function togglePause(){
  if (!S || S.phase === 'brief' || S.over) return;
  if (S.phase === 'run'){ S.phase = 'paused'; $('pause').hidden = false; keys = {}; }
  else if (S.phase === 'paused'){ S.phase = 'run'; $('pause').hidden = true; }
}

/* =========================  SIMULATION  ========================= */

function update(dt, t){
  waterUni.value = t;
  if (water){
    water.position.set(camera.position.x, S.waterLevel, camera.position.z);
    waterOff.value.set(camera.position.x, camera.position.z);
  }

  // ambient world motion runs even on the briefing screen
  updateRain(dt);
  updatePalms(t);
  updateDebris(dt, t);
  updateLightning(dt);
  if (schoolBeacon){
    var pulse = 0.55 + Math.sin(t * 3.1) * 0.45;
    schoolBeacon.userData.light.intensity = 1.2 + pulse * 2.2;
  }

  if (S.phase === 'run'){
    S.t += dt;
    S.timeLeft = Math.max(0, CFG.missionTime - S.t);
    S.waterLevel = CFG.riseTotal * (S.t / CFG.missionTime);
    updateBoat(dt, t);
    updateVictims(dt, t);
    updateRescue(dt);
    updateFlare(dt);
    if (S.timeLeft <= 0) endMission('time');
    var open = 0;
    for (var i = 0; i < victims.length; i++) if (!victims[i].safe && !victims[i].lost) open++;
    if (open === 0) endMission('clear');
  }

  updateCamera(dt, t);
  updateWake(dt, t);
  syncHUD();
  drawMinimap();
}

function updateRain(dt){
  if (!rain) return;
  var arr = rainPos.array, n = rainBase.length / 3;
  var cx = camera.position.x, cz = camera.position.z;
  var fall = 42 * dt, wind = 7 * dt;
  for (var i = 0; i < n; i++){
    var y = rainBase[i*3+1] - fall;
    var x = rainBase[i*3] + wind;
    if (y < -2){ y = 56; }
    if (x > 70) x -= 140;
    rainBase[i*3] = x; rainBase[i*3+1] = y;
    var wx = cx + x, wz = cz + rainBase[i*3+2];
    arr[i*6]   = wx;        arr[i*6+1] = y;        arr[i*6+2] = wz;
    arr[i*6+3] = wx + 0.30; arr[i*6+4] = y - 1.25; arr[i*6+5] = wz;
  }
  rainPos.needsUpdate = true;
}

function updatePalms(t){
  for (var i = 0; i < palms.length; i++){
    palms[i].rotation.z = Math.sin(t * 1.7 + palms[i].userData.sway) * 0.09;
  }
}

function updateDebris(dt, t){
  for (var i = 0; i < debris.length; i++){
    var d = debris[i], m = d.mesh;
    m.position.x += Math.sin(t * 0.21 + d.phase) * d.drift * dt;
    m.position.z += Math.cos(t * 0.17 + d.phase) * d.drift * dt;
    m.position.y = waterY(m.position.x, m.position.z, t) + 0.1;
    m.rotation.y += dt * 0.12 * (d.phase > 3 ? 1 : -1);
    m.rotation.z = Math.sin(t * 1.1 + d.phase) * 0.08;
  }
}

function updateLightning(dt){
  if (reduceMotion) return;
  S.lightning -= dt;
  if (S.lightning <= 0){
    S.lightning = rnd(6, 15);
    S.flashV = 1;
  }
  if (S.flashV > 0){
    S.flashV = Math.max(0, S.flashV - dt * 3.4);
    var f = S.flashV * (0.55 + Math.random() * 0.45);
    hemi.intensity = 0.92 + f * 2.6;
    $('flash').style.opacity = (f * 0.30).toFixed(3);
    if (S.flashV === 0){ hemi.intensity = 0.92; $('flash').style.opacity = '0'; }
  }
}

function updateBoat(dt, t){
  var steer = axisSteer();
  var fwd  = (keys['w'] || keys['arrowup']) ? 1 : 0;
  var back = (keys['s'] || keys['arrowdown']) ? 1 : 0;
  var boosting = !!(keys['shift'] && fwd);

  // S is a real brake first and astern second
  var accel = 0;
  if (fwd) accel = boosting ? 15.5 : 10.5;
  else if (back) accel = S.speed > 0.4 ? -16 : -5.5;

  // let off the throttle and she settles, instead of coasting for a block
  var idleDrag = (fwd || back) ? 0.85 : 1.9;
  var drag = S.speed * idleDrag + S.speed * Math.abs(S.speed) * 0.055;
  S.speed += (accel - drag) * dt;
  S.speed = clamp(S.speed, -4.2, boosting ? 15 : 11.2);

  // keeps authority at a standstill so you can pivot alongside a roof
  var turnAuth = 0.42 + 0.58 * clamp(Math.abs(S.speed) / 6, 0, 1);
  S.yaw -= steer * dt * 1.85 * turnAuth * (S.speed < -0.2 ? -1 : 1);

  var fx = Math.sin(S.yaw), fz = Math.cos(S.yaw);
  var nx = S.x + fx * S.speed * dt;
  var nz = S.z + fz * S.speed * dt;

  // storm current drags the boat sideways
  var cur = 0.22 + S.t / CFG.missionTime * 0.38;
  nx += Math.sin(t * 0.09 + 1.2) * cur * dt;
  nz += Math.cos(t * 0.07) * cur * dt;

  // operational boundary
  var dist = Math.hypot(nx, nz);
  if (dist > CFG.bounds){
    var push = (dist - CFG.bounds) * 2.2 * dt;
    nx -= (nx / dist) * push * 6;
    nz -= (nz / dist) * push * 6;
    S.speed *= 0.97;
    setAlert('Leaving the operational area');
  } else if (dist > CFG.bounds - 12){
    setAlert('Approaching the edge of the barangay');
  } else {
    clearAlert('edge');
  }

  // collisions
  var r = 1.5;
  for (var i = 0; i < buildings.length; i++){
    var b = buildings[i];
    if (Math.abs(nx - b.x) > b.hw + r + 2 || Math.abs(nz - b.z) > b.hd + r + 2) continue;
    var px = (b.hw + r) - Math.abs(nx - b.x);
    var pz = (b.hd + r) - Math.abs(nz - b.z);
    if (px > 0 && pz > 0){
      var nrmX = 0, nrmZ = 0;
      if (px < pz){ nx += (nx < b.x ? -px : px); nrmX = (nx < b.x ? -1 : 1); }
      else        { nz += (nz < b.z ? -pz : pz); nrmZ = (nz < b.z ? -1 : 1); }
      var headOn = Math.abs(Math.sin(S.yaw) * nrmX + Math.cos(S.yaw) * nrmZ);
      var impact = Math.abs(S.speed) * headOn;
      if (impact > 3.6) hullDamage(impact * 1.7, 'Hull hit a wall');
      // square-on collapses the speed, a parallel graze lets you slide
      S.speed *= Math.pow(0.02 + (1 - headOn) * 0.93, dt);
    }
  }
  for (var d = 0; d < debris.length; d++){
    var dm = debris[d];
    var ddx = nx - dm.mesh.position.x, ddz = nz - dm.mesh.position.z;
    var rr = dm.r + r * 0.7;
    var dd = Math.hypot(ddx, ddz);
    if (dd < rr && dd > 0.0001){
      var ov = (rr - dd) / dd;
      nx += ddx * ov * 0.3; nz += ddz * ov * 0.3;
      dm.mesh.position.x -= ddx * ov * 1.5;
      dm.mesh.position.z -= ddz * ov * 1.5;
      var imp = Math.abs(S.speed);
      if (imp > 5.5) hullDamage(imp * 0.8, 'Debris strike');
      S.speed *= Math.pow(0.5, dt);
    }
  }

  S.distance += Math.hypot(nx - S.x, nz - S.z);
  S.x = nx; S.z = nz;

  // ride the swell
  var yc = waterY(S.x, S.z, t);
  boatRoot.position.set(S.x, yc + 0.28, S.z);
  boatRoot.rotation.y = S.yaw;

  var fwW = waterY(S.x + fx * 2.1, S.z + fz * 2.1, t);
  var aftW = waterY(S.x - fx * 2.1, S.z - fz * 2.1, t);
  var rx = fz, rz = -fx;
  var stbW = waterY(S.x + rx * 1.1, S.z + rz * 1.1, t);
  var prtW = waterY(S.x - rx * 1.1, S.z - rz * 1.1, t);
  boatTilt.rotation.x = Math.atan2(aftW - fwW, 4.2) + clamp(S.speed, 0, 12) * 0.008;
  boatTilt.rotation.z = Math.atan2(prtW - stbW, 2.2) + steer * clamp(S.speed / 11, 0, 1) * 0.16;

  // flashing rescue light
  var bar = boatRoot.userData.bar;
  if (bar) bar.material.emissiveIntensity = 0.5 + (Math.sin(t * 7) > 0 ? 1.6 : 0);
}

function hullDamage(amount, why){
  if (S.hull <= 0) return;
  S.hull = Math.max(0, S.hull - amount);
  if (S.hull <= 0) capsize();
  else if (amount > 8) toast(why + ' — hull at ' + Math.round(S.hull) + '%', 'bad');
}

function capsize(){
  S.capsizes++;
  var lostNames = [];
  for (var i = 0; i < S.aboard.length; i++){
    var v = S.aboard[i];
    v.aboard = false; v.lost = true;
    v.group.visible = false;
    S.lost++;
    lostNames.push(v.data.name.split(',')[0]);
  }
  S.aboard = [];
  for (var s = 0; s < seatSlots.length; s++) seatSlots[s].visible = false;
  S.hull = 58; S.speed = 0;
  S.x = school.x + 11; S.z = school.z + 13; S.yaw = 0;
  toast('Boat swamped and righted at the centre' + (lostNames.length ? ' — ' + lostNames.join(', ') + ' swept away' : ''), 'bad');
}

function updateVictims(dt, t){
  for (var i = 0; i < victims.length; i++){
    var v = victims[i];
    if (v.safe || v.lost || v.aboard) continue;

    // a low roof with the water climbing it is far more urgent than a high one
    var exposure = clamp(1 - (v.roofY - S.waterLevel - 3.2) / 3.4, 0, 1);
    var drain = 0.18 + exposure * 0.24 + 0.26 * (S.t / CFG.missionTime);
    v.hold -= drain * dt;
    v.exposure = exposure;

    if (v.hold <= 0){
      v.hold = 0; v.lost = true; S.lost++;
      v.group.visible = false;
      toast(v.data.name.split(',')[0] + ' was swept off the roof', 'bad');
      continue;
    }

    var d = Math.hypot(v.x - S.x, v.z - S.z);
    if (!v.known && d < CFG.discover){
      v.known = true;
      toast('Signal spotted — ' + v.data.name, 'info');
    }

    var show = v.known || S.flareT > 0;
    var urgency = 1 - v.hold / 100;
    var op = show ? (0.10 + Math.sin(t * 2.6 + v.phase) * 0.035 + urgency * 0.08) : 0;
    v.col.material.opacity = op;
    v.col.material.color.setRGB(1, 0.36 - urgency * 0.22, 0.29 - urgency * 0.2);
    v.lamp.material.opacity = show ? 0.55 + Math.sin(t * 5 + v.phase) * 0.4 : 0;

    // waving for the boat, faster when it is close
    var arm = v.person.userData.arm;
    if (arm) arm.rotation.z = -0.5 + Math.sin(t * (d < 26 ? 9 : 4) + v.phase) * 0.7;
    v.person.rotation.y = Math.atan2(S.x - v.x, S.z - v.z);
    v.group.position.y = v.roofY + Math.max(0, S.waterLevel - v.roofY + 0.4) * 0.5;
  }
}

function updateRescue(dt){
  // unloading at the evacuation centre
  var dSchool = Math.hypot(S.x - school.x, S.z - school.z);
  if (dSchool < school.radius && S.aboard.length){
    S.unloadT += dt;
    if (S.unloadT >= CFG.unloadTime){
      S.unloadT = 0;
      var v = S.aboard.shift();
      v.aboard = false; v.safe = true; S.rescued++;
      refreshSeats();
      toast(v.data.name + ' is inside the evacuation centre', 'good');
      if (S.hull < 100) S.hull = Math.min(100, S.hull + 6);
    }
    setPrompt('Evacuation centre', 'Unloading — ' + S.aboard.length + ' still aboard', S.unloadT / CFG.unloadTime);
    return;
  } else {
    S.unloadT = 0;
  }

  // nearest reachable resident
  var best = null, bestD = 1e9;
  for (var i = 0; i < victims.length; i++){
    var v = victims[i];
    if (v.safe || v.lost || v.aboard) continue;
    var d = Math.hypot(v.x - S.x, v.z - S.z);
    if (d < CFG.rescueRange && d < bestD){ best = v; bestD = d; }
  }

  if (!best){
    S.boardT = 0; S.boardTarget = null;
    hidePrompt();
    return;
  }

  if (S.aboard.length >= CFG.capacity){
    setPrompt(best.data.name, 'Boat is full — run them to the centre first', 0);
    S.boardT = 0;
    return;
  }

  var holding = !!keys['e'];
  if (S.boardTarget !== best){ S.boardTarget = best; S.boardT = 0; }
  if (holding && Math.abs(S.speed) < 6.5){
    S.boardT += dt;
    if (S.boardT >= CFG.boardTime){
      best.aboard = true; best.known = true;
      best.group.visible = false;
      S.aboard.push(best);
      S.boardT = 0; S.boardTarget = null;
      refreshSeats();
      toast(best.data.name + ' aboard — ' + best.data.note, 'good');
      hidePrompt();
      return;
    }
  } else {
    S.boardT = Math.max(0, S.boardT - dt * 1.6);
  }
  var note = Math.abs(S.speed) >= 6.5 ? 'Slow down alongside' : 'Hold <span class="key">E</span> to bring aboard';
  setPrompt(best.data.name + ' — ' + Math.round(best.hold) + '%', note, S.boardT / CFG.boardTime);
}

function refreshSeats(){
  for (var i = 0; i < seatSlots.length; i++) seatSlots[i].visible = i < S.aboard.length;
}

function updateFlare(dt){
  if (S.flareT > 0) S.flareT = Math.max(0, S.flareT - dt);
  if (S.flareCD > 0) S.flareCD = Math.max(0, S.flareCD - dt);
  if (keys[' '] && S.flareCD <= 0){
    S.flareCD = CFG.flareCool;
    S.flareT = CFG.flareShow;
    keys[' '] = false;
    toast('Signal flare up — every roof lit for six seconds. Mark them.', 'info');
  }
}

function updateWake(dt, t){
  for (var i = 0; i < wakePool.length; i++){
    var w = wakePool[i];
    if (w.life > 0){
      w.life -= dt;
      var k = Math.max(0, w.life / 1.4);
      w.mesh.material.opacity = k * 0.38;
      var sc = 1 + (1 - k) * 2.6;
      w.mesh.scale.set(sc, 1, sc);
      w.mesh.position.y = waterY(w.mesh.position.x, w.mesh.position.z, t) + 0.06;
      if (w.life <= 0) w.mesh.visible = false;
    }
  }
  if (S.phase !== 'run' || Math.abs(S.speed) < 2.6) return;
  elapsedFrames++;
  if (elapsedFrames % 3) return;
  var w2 = wakePool[wakeIdx = (wakeIdx + 1) % wakePool.length];
  var fx = Math.sin(S.yaw), fz = Math.cos(S.yaw);
  w2.mesh.position.set(S.x - fx * 2.4 + rnd(-0.7, 0.7), 0, S.z - fz * 2.4 + rnd(-0.7, 0.7));
  w2.mesh.scale.set(1, 1, 1);
  w2.mesh.visible = true;
  w2.life = 1.4;
}

function updateCamera(dt, t){
  var k = 1 - Math.exp(-5.2 * dt);
  if (S.phase === 'brief'){
    var a = t * 0.085;
    camera.position.set(Math.sin(a) * 46, 19 + Math.sin(t * 0.3) * 1.5, Math.cos(a) * 46);
    camera.lookAt(0, 5, 0);
    return;
  }
  var fx = Math.sin(S.yaw), fz = Math.cos(S.yaw);
  var fast = clamp(Math.abs(S.speed) / 11, 0, 1);
  var back2 = 10.6 + fast * 3.6, up = 4.9 + fast * 1.5;
  TMP.v1.set(S.x - fx * back2, boatRoot.position.y + up, S.z - fz * back2);
  camera.position.lerp(TMP.v1, k);
  TMP.v2.set(S.x + fx * 7, boatRoot.position.y + 1.3, S.z + fz * 7);
  camera.lookAt(TMP.v2);
  var targetFov = 58 + clamp(Math.abs(S.speed) - 8, 0, 7) * 0.9;
  camera.fov += (targetFov - camera.fov) * k;
  camera.updateProjectionMatrix();
}

/* =========================  HUD  ========================= */

var alertMsg = null, toastList = [];

function setAlert(m){ alertMsg = m; }
function clearAlert(){ alertMsg = null; }

function toast(msg, kind){
  var box = $('toast');
  var el = document.createElement('div');
  el.className = kind === 'bad' ? 'bad' : (kind === 'info' ? 'info' : '');
  el.textContent = msg;
  box.appendChild(el);
  box.hidden = false;
  toastList.push({ el: el, t: 3.4 });
  while (toastList.length > 3){
    var old = toastList.shift();
    if (old.el.parentNode) old.el.parentNode.removeChild(old.el);
  }
}
function tickToasts(dt){
  for (var i = toastList.length - 1; i >= 0; i--){
    toastList[i].t -= dt;
    if (toastList[i].t <= 0){
      var o = toastList.splice(i, 1)[0];
      if (o.el.parentNode) o.el.parentNode.removeChild(o.el);
    }
  }
  $('toast').hidden = toastList.length === 0;
}

function setPrompt(name, note, progress){
  var p = $('prompt');
  p.hidden = false;
  $('promptName').textContent = name;
  $('promptNote').innerHTML = note;
  $('promptBar').style.width = (clamp(progress, 0, 1) * 100).toFixed(1) + '%';
}
function hidePrompt(){ $('prompt').hidden = true; }

function buildPips(){
  var box = $('pips');
  box.innerHTML = '';
  for (var i = 0; i < victims.length; i++){
    var d = document.createElement('div');
    d.className = 'pip';
    box.appendChild(d);
  }
  var seats = $('seats');
  seats.innerHTML = '';
  for (var s = 0; s < CFG.capacity; s++){
    var e = document.createElement('div');
    e.className = 'seat';
    seats.appendChild(e);
  }
}

function syncHUD(){
  var mm = Math.floor(S.timeLeft / 60), ss = Math.floor(S.timeLeft % 60);
  $('clock').textContent = (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
  $('clockpanel').classList.toggle('urgent', S.timeLeft < 60);

  var pips = $('pips').children;
  for (var i = 0; i < victims.length && i < pips.length; i++){
    var v = victims[i];
    pips[i].className = 'pip' + (v.safe ? ' safe' : v.lost ? ' lost' : v.aboard ? ' aboard' : v.known ? ' known' : '');
  }
  $('rescued').textContent = S.rescued;
  $('lost').textContent = S.lost;

  var hb = $('hullbar');
  hb.style.width = S.hull + '%';
  hb.className = S.hull < 30 ? 'low' : S.hull < 65 ? 'mid' : '';
  $('hullval').textContent = Math.round(S.hull) + '%';

  var seats = $('seats').children;
  for (var s = 0; s < seats.length; s++) seats[s].className = 'seat' + (s < S.aboard.length ? ' full' : '');

  if (S.flareT > 0){
    $('flarebar').style.width = (S.flareT / CFG.flareShow * 100) + '%';
    $('flareval').textContent = 'LIT';
  } else if (S.flareCD > 0){
    $('flarebar').style.width = ((1 - S.flareCD / CFG.flareCool) * 100) + '%';
    $('flareval').textContent = Math.ceil(S.flareCD) + 's';
  } else {
    $('flarebar').style.width = '100%';
    $('flareval').textContent = 'READY';
  }

  var obj = $('objective');
  if (S.aboard.length >= CFG.capacity) obj.textContent = 'Boat full — run them to the evacuation centre.';
  else if (S.aboard.length) obj.textContent = S.aboard.length + ' aboard. Room for ' + (CFG.capacity - S.aboard.length) + ' more.';
  else obj.textContent = 'Floodwater rising — find residents by their signal lights.';

  // where to point the bow
  var arrow = $('bearArrow'), btext = $('bearText'), tgt = null, tname = '', toCentre = false;
  if (S.aboard.length >= CFG.capacity){ tgt = school; tname = 'evacuation centre'; toCentre = true; }
  else {
    var bd = 1e9;
    for (var k2 = 0; k2 < victims.length; k2++){
      var vk = victims[k2];
      if (vk.safe || vk.lost || vk.aboard || !vk.known) continue;
      var dk = Math.hypot(vk.x - S.x, vk.z - S.z);
      if (dk < bd){ bd = dk; tgt = vk; tname = vk.data.name.split(',')[0]; }
    }
    if (!tgt && S.aboard.length){ tgt = school; tname = 'evacuation centre'; toCentre = true; }
  }
  if (tgt){
    var rel = Math.atan2(tgt.x - S.x, tgt.z - S.z) - S.yaw;
    arrow.style.transform = 'rotate(' + (-rel * 180 / Math.PI).toFixed(1) + 'deg)';
    arrow.className = toCentre ? 'toCentre' : '';
    arrow.style.visibility = 'visible';
    btext.textContent = Math.round(Math.hypot(tgt.x - S.x, tgt.z - S.z)) + ' m — ' + tname;
  } else {
    arrow.style.visibility = 'hidden';
    btext.textContent = 'Sweep for signals — Space for a flare';
  }

  var a = $('alert');
  var msg = alertMsg;
  if (!msg && S.phase === 'run' && S.timeLeft < 60 && S.timeLeft > 0) msg = 'Current building — pull out in ' + Math.ceil(S.timeLeft) + 's';
  if (msg){ a.hidden = false; a.textContent = msg; } else { a.hidden = true; }
}

function drawMinimap(){
  var c = $('minimap'), g = c.getContext('2d');
  var W = c.width, H = c.height, half = CFG.bounds + 8;
  var sc = W / (half * 2);
  function mx(x){ return W / 2 + x * sc; }
  function my(z){ return H / 2 + z * sc; }

  g.fillStyle = '#0d1f22';
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(140,170,185,.20)';
  for (var i = 0; i < buildings.length; i++){
    var b = buildings[i];
    g.fillRect(mx(b.x - b.hw), my(b.z - b.hd), b.hw * 2 * sc, b.hd * 2 * sc);
  }
  // operational boundary
  g.strokeStyle = 'rgba(255,91,74,.35)';
  g.setLineDash([3, 4]);
  g.beginPath(); g.arc(W / 2, H / 2, CFG.bounds * sc, 0, 6.2832); g.stroke();
  g.setLineDash([]);

  // evacuation centre
  g.fillStyle = '#57d9a8';
  g.fillRect(mx(school.x) - 4, my(school.z) - 4, 8, 8);

  // known residents
  for (var v = 0; v < victims.length; v++){
    var r = victims[v];
    if (r.safe || r.lost || r.aboard) continue;
    if (!r.known && S.flareT <= 0) continue;
    g.fillStyle = r.hold < 35 ? '#ff5b4a' : '#f0a33c';
    g.beginPath(); g.arc(mx(r.x), my(r.z), 3.2, 0, 6.2832); g.fill();
  }

  // boat
  g.save();
  g.translate(mx(S.x), my(S.z));
  g.rotate(-S.yaw + Math.PI);
  g.fillStyle = '#e7f0f4';
  g.beginPath(); g.moveTo(0, -5.5); g.lineTo(3.6, 4.4); g.lineTo(-3.6, 4.4); g.closePath(); g.fill();
  g.restore();
}

/* =========================  END OF MISSION  ========================= */

function endMission(reason){
  if (S.over) return;
  S.over = true;
  S.phase = 'over';
  hidePrompt();
  clearAlert();

  var score = Math.max(0,
    Math.round(S.rescued * 1200 + S.timeLeft * 8 + S.hull * 4 - S.capsizes * 400 - S.lost * 600));
  S.score = score;

  var all = victims.length;
  var title, eyebrow, text;
  if (S.rescued === all){
    eyebrow = 'After-action report — all accounted for';
    title = 'Barangay cleared';
    text = 'Every resident on the roster is inside San Isidro Elementary School. The MDRRMO logs Unit 7 as clear with ' +
           Math.floor(S.timeLeft) + ' seconds of usable water left.';
  } else if (reason === 'time'){
    eyebrow = 'After-action report — recall ordered';
    title = 'Recall ordered';
    text = 'The current made the streets impassable and Unit 7 was recalled with ' + (all - S.rescued - S.lost) +
           ' still on the roofs. ' + S.rescued + ' of ' + all + ' reached the centre.';
  } else if (S.lost > 0){
    eyebrow = 'After-action report — casualties';
    title = 'Mission closed with losses';
    text = S.rescued + ' of ' + all + ' residents reached the evacuation centre. ' + S.lost +
           ' were swept off before the boat got there.';
  } else {
    eyebrow = 'After-action report';
    title = 'Mission complete';
    text = S.rescued + ' of ' + all + ' residents reached the evacuation centre.';
  }
  $('sumEyebrow').textContent = eyebrow;
  $('sumTitle').textContent = title;
  $('sumText').textContent = text;

  var stars = (S.rescued === all && S.capsizes === 0) ? 3 : (S.rescued >= Math.ceil(all * 0.75) ? 2 : (S.rescued > 0 ? 1 : 0));
  var cells = [
    ['Extracted', S.rescued + ' / ' + all, S.rescued === all ? 'good' : (S.rescued ? 'warn' : 'bad')],
    ['Lost', String(S.lost), S.lost ? 'bad' : 'good'],
    ['Hull left', Math.round(S.hull) + '%', S.hull > 60 ? 'good' : S.hull > 25 ? 'warn' : 'bad'],
    ['Swampings', String(S.capsizes), S.capsizes ? 'bad' : 'good'],
    ['Distance', Math.round(S.distance) + ' m', ''],
    ['Time left', Math.floor(S.timeLeft / 60) + ':' + ('0' + Math.floor(S.timeLeft % 60)).slice(-2), S.timeLeft > 30 ? 'good' : 'warn'],
    ['Rating', '★'.repeat(stars) + '☆'.repeat(3 - stars), stars === 3 ? 'good' : 'warn'],
    ['Score', String(score), '']
  ];
  var html = '';
  for (var i = 0; i < cells.length; i++){
    html += '<div><div class="k">' + cells[i][0] + '</div><div class="v ' + cells[i][2] + '">' + cells[i][1] + '</div></div>';
  }
  $('sumScores').innerHTML = html;

  var roster = '';
  for (var v = 0; v < victims.length; v++){
    var r = victims[v];
    var cls = r.safe ? 'ok' : (r.lost ? 'no' : '');
    var status = r.safe ? 'safe' : (r.lost ? 'lost' : 'still on the roof');
    roster += '<span class="' + cls + '">' + r.data.name + ' &mdash; <b>' + status + '</b></span>';
  }
  $('sumRoster').innerHTML = roster;

  // persist the run, then show where it landed on the board
  // keep completion_status and the written verdict in agreement
  var status = (S.rescued === all) ? 'cleared'
             : (reason === 'time') ? 'recalled'
             : (S.rescued === 0)   ? 'failed'
             : 'partial';
  var run = buildRun(status, title);
  lastRun = run;
  var srow = $('saveRow');
  srow.className = 'saverow';
  srow.innerHTML = '<b>Saving run&hellip;</b>';
  $('board').innerHTML = '<div class="empty">Loading&hellip;</div>';

  saveRun(run, function(err, where){
    if (where === 'remote'){
      srow.className = 'saverow ok';
      srow.innerHTML = '<b>Saved to Supabase</b> &middot; ' + esc(run.player_name) + ' &middot; ' + run.score
                     + ' pts &middot; player_id ' + esc(run.player_id.slice(0, 8)) + '&hellip;';
    } else if (err){
      srow.className = 'saverow warn';
      srow.innerHTML = '<b>' + esc(dbHint(err)) + '</b> &middot; run kept in this browser instead';
      if (window.console) console.warn('[bayanihan] save failed:', err.message || err);
    } else {
      srow.className = 'saverow';
      srow.innerHTML = '<b>Saved locally</b> &middot; add your Supabase URL and key to store it in the database';
    }
    fetchBoard(function(e2, rows){ renderBoard(rows, run); });
  });

  $('summary').hidden = false;
  $('hud').hidden = true;
  $('touch').hidden = true;
}

/* =========================  DATA STORE  =========================
   Supabase (PostgreSQL). Paste your project's URL and anon public key
   below — Supabase dashboard → Project Settings → API. Leave them blank
   and the game falls back to this browser's own storage so it still runs.

   The anon key is meant to be public; Row Level Security in
   db/schema.sql is what protects the table. Never paste the
   service_role key here.
   ================================================================ */

var EXT = (typeof window !== 'undefined' && window.BAYANIHAN_CONFIG) || {};

var DB = {
  url   : EXT.supabaseUrl     || '',   // set in config.js (kept out of version control)
  key   : EXT.supabaseAnonKey || '',
  table : 'game_runs',
  view  : 'leaderboard',        // one row per player_id
  level : 'San Isidro'
};
DB.live = function(){ return !!(DB.url && DB.key && typeof fetch === 'function'); };
DB.rest = function(q, rel){ return DB.url.replace(/\/+$/, '') + '/rest/v1/' + (rel || DB.table) + (q || ''); };
DB.head = function(extra){
  var h = { 'apikey': DB.key, 'Authorization': 'Bearer ' + DB.key };
  if (extra) for (var k in extra) h[k] = extra[k];
  return h;
};

var DB_TIMEOUT = 8000;

/* A request that never settles would leave the after-action screen stuck on
   "Saving run...", so every call to Supabase is given a deadline. */
function dbFetch(url, opts){
  opts = opts || {};
  var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
  if (ctrl) opts.signal = ctrl.signal;
  var timer = setTimeout(function(){ if (ctrl) ctrl.abort(); }, DB_TIMEOUT);
  var clear = function(){ clearTimeout(timer); };
  return fetch(url, opts).then(
    function(res){ clear(); return res; },
    function(err){
      clear();
      if (err && err.name === 'AbortError') throw new Error('Request timed out');
      throw err;
    }
  );
}

var LOCAL_KEY   = 'bayanihan.runs';
var NAME_KEY    = 'bayanihan.callsign';
var PLAYER_KEY  = 'bayanihan.player_id';
var PENDING_KEY = 'bayanihan.pending';

function safeGet(k){ try { return window.localStorage.getItem(k); } catch(e){ return null; } }
function safeSet(k, v){ try { window.localStorage.setItem(k, v); } catch(e){} }

/* A player's unique id: a random UUID minted once on this device and kept in
   browser storage, so every run this person plays carries the same player_id.
   Nothing personal is encoded in it. */
function newUuid(){
  try {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    if (window.crypto && window.crypto.getRandomValues){
      var b = new Uint8Array(16);
      window.crypto.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40;              // version 4
      b[8] = (b[8] & 0x3f) | 0x80;              // variant 10
      var h = [];
      for (var i = 0; i < 16; i++) h.push((b[i] + 0x100).toString(16).slice(1));
      return h.slice(0,4).join('') + '-' + h.slice(4,6).join('') + '-' + h.slice(6,8).join('')
           + '-' + h.slice(8,10).join('') + '-' + h.slice(10,16).join('');
    }
  } catch(e){}
  // last resort for browsers with no crypto API
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){
    var r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var playerId = null;
function getPlayerId(){
  if (playerId) return playerId;
  var stored = safeGet(PLAYER_KEY);
  playerId = (stored && UUID_RE.test(stored)) ? stored : newUuid();
  if (playerId !== stored) safeSet(PLAYER_KEY, playerId);
  return playerId;
}

function cleanName(raw){
  var n = String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (n.length > 24) n = n.slice(0, 24);
  return n || 'Rescue Unit 7';
}

var memRuns = [];
var lastRun = null;
function localRuns(){
  var stored = [];
  try { stored = JSON.parse(safeGet(LOCAL_KEY) || '[]') || []; } catch(e){ stored = []; }
  if (!Array.isArray(stored)) stored = [];
  var seen = {}, out = [];
  stored.concat(memRuns).forEach(function(r){
    if (!r || typeof r.score !== 'number') return;
    var k = (r._t || 0) + '|' + (r.player_id || r.player_name) + '|' + r.score;
    if (seen[k]) return;
    seen[k] = 1;
    out.push(r);
  });
  out.sort(function(a, b){ return b.score - a.score; });
  // mirror the leaderboard view: best run per player
  var best = {}, top = [];
  out.forEach(function(r){
    var pid = r.player_id || r.player_name;
    if (best[pid]) return;
    best[pid] = 1;
    top.push(r);
  });
  return top;
}
function localSave(run){
  var copy;
  try { copy = JSON.parse(JSON.stringify(run)); } catch(e){ copy = run; }
  copy._t = Date.now();
  memRuns.push(copy);
  if (memRuns.length > 50) memRuns.shift();
  try { safeSet(LOCAL_KEY, JSON.stringify(localRuns().slice(0, 50))); } catch(e){}
}

/* Runs finished while the database was unreachable wait here so they are not
   stranded in this browser forever; the next load that reaches Supabase
   posts them. */
function pendingRuns(){
  var q;
  try { q = JSON.parse(safeGet(PENDING_KEY) || '[]'); } catch(e){ q = []; }
  return Array.isArray(q) ? q : [];
}

function queuePending(run){
  var q = pendingRuns();
  q.push(run);
  safeSet(PENDING_KEY, JSON.stringify(q.slice(-50)));
}

function flushPending(){
  if (!DB.live()) return;
  var q = pendingRuns();
  if (!q.length) return;
  safeSet(PENDING_KEY, '[]');
  q.forEach(function(run){
    postRun(run).catch(function(){ queuePending(run); });
  });
}

/* one row per finished mission — gameplay only, never anything personal */
function buildRun(status, verdict){
  return {
    player_id         : getPlayerId(),
    player_name       : S.playerName,
    score             : S.score,
    level             : DB.level,
    residents_rescued : S.rescued,
    residents_lost    : S.lost,
    time_remaining    : Math.max(0, Math.floor(S.timeLeft)),
    completion_status : status,
    remarks           : String(verdict || '').slice(0, 200)
  };
}

function postRun(run){
  return dbFetch(DB.rest(), {
    method  : 'POST',
    headers : DB.head({ 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }),
    body    : JSON.stringify(run)
  }).then(function(res){
    if (!res.ok) return res.text().then(function(t){
      var e = new Error(res.status + ' ' + t.slice(0, 160));
      e.status = res.status;
      throw e;
    });
    return true;
  });
}

function saveRun(run, done){
  if (!DB.live()){ localSave(run); queuePending(run); done(null, 'local'); return; }
  postRun(run)
    .then(function(){ done(null, 'remote'); })
    .catch(function(err){ localSave(run); queuePending(run); done(err, 'local'); });
}

function fetchBoard(done){
  if (!DB.live()){
    done(null, localRuns().slice(0, 8));
    return;
  }
  var q = '?select=player_id,player_name,score,residents_rescued,completion_status,created_at'
        + '&order=score.desc,created_at.asc&limit=8';
  var read = function(rel){
    return dbFetch(DB.rest(q, rel), { headers: DB.head() }).then(function(res){
      if (!res.ok) return res.text().then(function(t){ throw new Error(res.status + ' ' + t.slice(0, 140)); });
      return res.json();
    });
  };
  read(DB.view)
    .catch(function(){ return read(DB.table); })   // view not created yet
    .then(function(rows){ done(null, Array.isArray(rows) ? rows : []); })
    .catch(function(err){ done(err, localRuns().slice(0, 8)); });
}

function renderBoard(rows, mine){
  var box = $('board');
  if (!rows || !rows.length){ box.innerHTML = '<div class="empty">No runs recorded yet.</div>'; return; }
  var html = '<div class="row head"><span>#</span><span>Unit</span><span class="sc">Score</span><span class="rs">Saved</span></div>';
  var usedMine = false;
  for (var i = 0; i < rows.length; i++){
    var r = rows[i];
    var isMine = !usedMine && mine && (r.player_id ? r.player_id === mine.player_id
                                                    : r.player_name === mine.player_name && r.score === mine.score);
    if (isMine) usedMine = true;
    html += '<div class="row' + (isMine ? ' you' : '') + '">'
          + '<span class="rank">' + (i + 1) + '</span>'
          + '<span class="nm">' + esc(r.player_name) + '</span>'
          + '<span class="sc">' + r.score + '</span>'
          + '<span class="rs">' + (r.residents_rescued | 0) + '/' + victims.length + '</span>'
          + '</div>';
  }
  box.innerHTML = html;
}

function esc(t){
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// plain-language reason for a failed write, so the console is not the only clue
function dbHint(err){
  var code = err && err.status;
  if (code === 401 || code === 403) return 'Rejected by the database (check the anon key and the RLS insert policy)';
  if (code === 404) return 'Table not found — run db/schema.sql first';
  if (code === 400) return 'Row rejected — a value broke a CHECK constraint';
  if (code) return 'Database returned ' + code;
  return 'Could not reach the database';
}

function markStore(){
  var chip = $('dbChip');
  if (!chip) return;
  chip.className = 'chip' + (DB.live() ? ' live' : '');
  chip.textContent = (DB.live() ? 'Supabase connected' : 'Local store') + ' · player ' + getPlayerId().slice(0, 8);
  chip.title = 'player_id ' + getPlayerId();
}

/* =========================  LOOP  ========================= */

function resize(){
  var w = canvas.clientWidth || window.innerWidth;
  var h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  var mm = $('minimap');
  var px = Math.round(mm.clientWidth * Math.min(window.devicePixelRatio || 1, 2));
  if (px && mm.width !== px){ mm.width = px; mm.height = px; }
}

function frame(now){
  requestAnimationFrame(frame);
  var t = clock.getElapsedTime();
  var dt = Math.min(0.05, t - lastT);
  lastT = t;
  if (S.phase === 'paused'){ renderer.render(scene, camera); return; }
  update(dt, t);
  tickToasts(dt);
  renderer.render(scene, camera);
}

/* =========================  BOOT  ========================= */

function fail(){
  var b = $('briefText');
  if (b) b.innerHTML = 'The 3D engine could not be loaded from the CDN in this browser. ' +
    'Check the network connection and reload the page — everything else in the mission is ready.';
  var btn = $('startBtn');
  if (btn) { btn.textContent = 'Reload'; btn.onclick = function(){ location.reload(); }; }
}

function begin(){
  try { init(); }
  catch (err){
    if (window.console) console.error(err);
    fail();
  }
}

if (window.THREE){
  begin();
} else {
  var s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js';
  s.onload = function(){ window.THREE ? begin() : fail(); };
  s.onerror = fail;
  document.head.appendChild(s);
}

})();
