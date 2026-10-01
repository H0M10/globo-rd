// Genera, a partir del mapa de Natural Earth (escala 1:110m):
//   docs/data/paises.geojson  → mapa ligero con nombres en español (lo usa la página)
//   sql/02_paises.sql         → INSERT de los países (lo ejecutas en pgAdmin)
// Uso: node herramientas/preparar-datos.mjs
import fs from 'node:fs';

const raiz = new URL('../', import.meta.url);
const origen = JSON.parse(fs.readFileSync(new URL('herramientas/ne_110m_admin_0_countries.geojson', raiz), 'utf8'));

const NOMBRES = {
  AFG: 'Afganistán', AGO: 'Angola', ALB: 'Albania', ARE: 'Emiratos Árabes Unidos', ARG: 'Argentina',
  ARM: 'Armenia', ATA: 'Antártida', ATF: 'Tierras Australes Francesas', AUS: 'Australia', AUT: 'Austria',
  AZE: 'Azerbaiyán', BDI: 'Burundi', BEL: 'Bélgica', BEN: 'Benín', BFA: 'Burkina Faso',
  BGD: 'Bangladés', BGR: 'Bulgaria', BHS: 'Bahamas', BIH: 'Bosnia y Herzegovina', BLR: 'Bielorrusia',
  BLZ: 'Belice', BOL: 'Bolivia', BRA: 'Brasil', BRN: 'Brunéi', BTN: 'Bután',
  BWA: 'Botsuana', CAF: 'República Centroafricana', CAN: 'Canadá', CHE: 'Suiza', CHL: 'Chile',
  CHN: 'China', CIV: 'Costa de Marfil', CMR: 'Camerún', COD: 'República Democrática del Congo', COG: 'Congo',
  COL: 'Colombia', CRI: 'Costa Rica', CUB: 'Cuba', CYN: 'Chipre del Norte', CYP: 'Chipre',
  CZE: 'Chequia', DEU: 'Alemania', DJI: 'Yibuti', DNK: 'Dinamarca', DOM: 'República Dominicana',
  DZA: 'Argelia', ECU: 'Ecuador', EGY: 'Egipto', ERI: 'Eritrea', ESP: 'España',
  EST: 'Estonia', ETH: 'Etiopía', FIN: 'Finlandia', FJI: 'Fiyi', FLK: 'Islas Malvinas',
  FRA: 'Francia', GAB: 'Gabón', GBR: 'Reino Unido', GEO: 'Georgia', GHA: 'Ghana',
  GIN: 'Guinea', GMB: 'Gambia', GNB: 'Guinea-Bisáu', GNQ: 'Guinea Ecuatorial', GRC: 'Grecia',
  GRL: 'Groenlandia', GTM: 'Guatemala', GUY: 'Guyana', HND: 'Honduras', HRV: 'Croacia',
  HTI: 'Haití', HUN: 'Hungría', IDN: 'Indonesia', IND: 'India', IRL: 'Irlanda',
  IRN: 'Irán', IRQ: 'Irak', ISL: 'Islandia', ISR: 'Israel', ITA: 'Italia',
  JAM: 'Jamaica', JOR: 'Jordania', JPN: 'Japón', KAZ: 'Kazajistán', KEN: 'Kenia',
  KGZ: 'Kirguistán', KHM: 'Camboya', KOR: 'Corea del Sur', KOS: 'Kosovo', KWT: 'Kuwait',
  LAO: 'Laos', LBN: 'Líbano', LBR: 'Liberia', LBY: 'Libia', LKA: 'Sri Lanka',
  LSO: 'Lesoto', LTU: 'Lituania', LUX: 'Luxemburgo', LVA: 'Letonia', MAR: 'Marruecos',
  MDA: 'Moldavia', MDG: 'Madagascar', MEX: 'México', MKD: 'Macedonia del Norte', MLI: 'Malí',
  MMR: 'Birmania', MNE: 'Montenegro', MNG: 'Mongolia', MOZ: 'Mozambique', MRT: 'Mauritania',
  MWI: 'Malaui', MYS: 'Malasia', NAM: 'Namibia', NCL: 'Nueva Caledonia', NER: 'Níger',
  NGA: 'Nigeria', NIC: 'Nicaragua', NLD: 'Países Bajos', NOR: 'Noruega', NPL: 'Nepal',
  NZL: 'Nueva Zelanda', OMN: 'Omán', PAK: 'Pakistán', PAN: 'Panamá', PER: 'Perú',
  PHL: 'Filipinas', PNG: 'Papúa Nueva Guinea', POL: 'Polonia', PRI: 'Puerto Rico', PRK: 'Corea del Norte',
  PRT: 'Portugal', PRY: 'Paraguay', PSX: 'Palestina', QAT: 'Catar', ROU: 'Rumania',
  RUS: 'Rusia', RWA: 'Ruanda', SAH: 'Sahara Occidental', SAU: 'Arabia Saudita', SDN: 'Sudán',
  SDS: 'Sudán del Sur', SEN: 'Senegal', SLB: 'Islas Salomón', SLE: 'Sierra Leona', SLV: 'El Salvador',
  SOL: 'Somalilandia', SOM: 'Somalia', SRB: 'Serbia', SUR: 'Surinam', SVK: 'Eslovaquia',
  SVN: 'Eslovenia', SWE: 'Suecia', SWZ: 'Esuatini', SYR: 'Siria', TCD: 'Chad',
  TGO: 'Togo', THA: 'Tailandia', TJK: 'Tayikistán', TKM: 'Turkmenistán', TLS: 'Timor Oriental',
  TTO: 'Trinidad y Tobago', TUN: 'Túnez', TUR: 'Turquía', TWN: 'Taiwán', TZA: 'Tanzania',
  UGA: 'Uganda', UKR: 'Ucrania', URY: 'Uruguay', USA: 'Estados Unidos', UZB: 'Uzbekistán',
  VEN: 'Venezuela', VNM: 'Vietnam', VUT: 'Vanuatu', YEM: 'Yemen', ZAF: 'Sudáfrica',
  ZMB: 'Zambia', ZWE: 'Zimbabue',
};

const CONTINENTES = {
  'Africa': 'África', 'Antarctica': 'Antártida', 'Asia': 'Asia', 'Europe': 'Europa',
  'North America': 'América del Norte', 'Oceania': 'Oceanía',
  'Seven seas (open ocean)': 'Océanos', 'South America': 'América del Sur',
};

// Redondea a 2 decimales (≈1 km): el archivo pesa menos y carga más rápido en el celular.
const redondear = (c) => (Array.isArray(c[0]) ? c.map(redondear) : [Math.round(c[0] * 100) / 100, Math.round(c[1] * 100) / 100]);

// Centroide plano del anillo exterior más grande: sirve para "volar" hasta el país.
function centro(geom) {
  const anillos = geom.type === 'Polygon' ? [geom.coordinates[0]] : geom.coordinates.map((p) => p[0]);
  let mejor = null;
  for (const r of anillos) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
      a += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f;
    }
    a /= 2;
    if (!mejor || Math.abs(a) > mejor.area) {
      mejor = Math.abs(a) < 1e-9 ? { area: 0, lng: r[0][0], lat: r[0][1] } : { area: Math.abs(a), lng: cx / (6 * a), lat: cy / (6 * a) };
    }
  }
  return { lat: Math.round(mejor.lat * 100) / 100, lng: Math.round(mejor.lng * 100) / 100 };
}

const faltan = [];
const paises = origen.features.map((f) => {
  const iso = f.properties.ADM0_A3;
  const nombre = NOMBRES[iso] ?? f.properties.NAME;
  if (!NOMBRES[iso]) faltan.push(iso);
  const continente = CONTINENTES[f.properties.CONTINENT] ?? f.properties.CONTINENT;
  return {
    type: 'Feature',
    properties: { iso, nombre, continente, ...centro(f.geometry) },
    geometry: { type: f.geometry.type, coordinates: redondear(f.geometry.coordinates) },
  };
}).sort((a, b) => a.properties.nombre.localeCompare(b.properties.nombre, 'es'));

fs.writeFileSync(new URL('docs/data/paises.geojson', raiz), JSON.stringify({ type: 'FeatureCollection', features: paises }));

const sql = (t) => `'${String(t).replace(/'/g, "''")}'`;
const filas = paises.map(({ properties: p }) => `  (${sql(p.iso)}, ${sql(p.nombre)}, ${sql(p.continente)}, ${p.lat}, ${p.lng})`);
fs.writeFileSync(new URL('sql/02_paises.sql', raiz),
`-- 02 · Países del mapa (generado por herramientas/preparar-datos.mjs; no editar a mano)
-- ${paises.length} países de Natural Earth 1:110m. Ejecutar después de 01_esquema.sql.
INSERT INTO paises (iso, nombre, continente, lat, lng) VALUES
${filas.join(',\n')}
ON CONFLICT (iso) DO UPDATE
  SET nombre = EXCLUDED.nombre, continente = EXCLUDED.continente, lat = EXCLUDED.lat, lng = EXCLUDED.lng;
`);

const kb = (fs.statSync(new URL('docs/data/paises.geojson', raiz)).size / 1024).toFixed(0);
console.log(`Listo: ${paises.length} países · paises.geojson ${kb} KB · sql/02_paises.sql`);
if (faltan.length) console.log('Sin nombre en español (se usó el inglés):', faltan.join(', '));
