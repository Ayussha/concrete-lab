const S = require('../js/standards.js');
const {IS456, IS516, IS5816, IS1199, Durability, IS2386, IS4031} = S;
let pass=0, fail=0;
function ck(name, got, want, tol){
  tol = tol===undefined?1e-6:tol;
  const ok = (typeof want==='number') ? Math.abs(got-want)<=tol : got===want;
  if(ok){pass++; console.log('  ok  '+name+'  = '+got);}
  else {fail++; console.log('  FAIL '+name+'  got '+got+'  want '+want);}
}

console.log('\n-- IS 456 acceptance limits (Cl.16.1 / Table 11) --');
let a = IS456.assessAcceptance([], 'M25', null);
ck('M25 mean limit (fck+4 governs vs fck+0.825x4=3.3->3.5)', a.meanLimit, 29);
ck('M25 individual limit (fck-4)', a.individualLimit, 21);
a = IS456.assessAcceptance([], 'M15', null);
ck('M15 mean limit (fck+3 vs 0.825x3.5=2.89->3.0)', a.meanLimit, 18);
ck('M15 individual limit (fck-3)', a.individualLimit, 12);
a = IS456.assessAcceptance([], 'M30', null);
ck('M30 mean limit (0.825x5=4.125->4.0 ; fck+4)', a.meanLimit, 34);
a = IS456.assessAcceptance([], 'M30', 6.5);
ck('M30 with site s=6.5 (0.825x6.5=5.36->5.5)', a.meanLimit, 35.5);

console.log('\n-- IS 456 grouping: non-overlapping fours --');
a = IS456.assessAcceptance([35,36,34,37, 33,38,36,35, 34], 'M30', null);
ck('group count from 9 results', a.groups.length, 2);
ck('group1 spans 1-4', a.groups[0].from+'-'+a.groups[0].to, '1-4');
ck('group2 spans 5-8', a.groups[1].from+'-'+a.groups[1].to, '5-8');
ck('remainder note present', a.notes.some(n=>n.indexOf('outside the last complete group')>-1), true);
ck('status COMPLIES', a.status, 'COMPLIES');

a = IS456.assessAcceptance([35,36,34,37, 25,38,36,35], 'M30', null);
ck('one individual below fck-4 => fails', a.status, 'DOES NOT COMPLY');
a = IS456.assessAcceptance([31,32,31,32], 'M30', null);
ck('all individuals ok but mean 31.5 < 34 => fails', a.status, 'DOES NOT COMPLY');
a = IS456.assessAcceptance([35,36,34], 'M30', null);
ck('3 results => PROVISIONAL', a.status, 'PROVISIONAL');

console.log('\n-- IS 10262 target mean strength --');
let t = IS456.targetMeanStrength('M30', null);
ck('M30 TMS = max(30+1.65*5, 30+6.5) = 38.25', t.target, 38.25);
ck('governed by 1.65s', t.governedBy, 'fck + 1.65s');

console.log('\n-- IS 456 sampling frequency (Table 15) --');
ck('5 m3 -> 1 sample', IS456.samplingFrequency(5).samples, 1);
ck('15 m3 -> 2', IS456.samplingFrequency(15).samples, 2);
ck('30 m3 -> 3', IS456.samplingFrequency(30).samples, 3);
ck('50 m3 -> 4', IS456.samplingFrequency(50).samples, 4);
ck('51 m3 -> 5', IS456.samplingFrequency(51).samples, 5);
ck('100 m3 -> 5', IS456.samplingFrequency(100).samples, 5);
ck('101 m3 -> 6', IS456.samplingFrequency(101).samples, 6);
ck('cubes for 28d at 100 m3', IS456.samplingFrequency(100).cubesFor28Day, 15);

console.log('\n-- IS 516 compressive strength --');
ck('150mm cube area', IS516.cubeArea(150), 22500);
ck('700 kN on 150mm cube -> 31.0 (nearest 0.5)', IS516.cubeStrength(700, 22500), 31);
ck('472.5 kN on 150mm -> 21.0', IS516.cubeStrength(472.5, 22500), 21);
ck('100mm cube 310 kN -> 31.0', IS516.cubeStrength(310, 10000), 31);
let sr = IS516.sampleResult([31,32,30]);
ck('sample mean 31', sr.mean, 31);
ck('within 15% -> valid', sr.valid, true);
sr = IS516.sampleResult([31,32,20]);
ck('one specimen >15% off -> invalid', sr.valid, false);
ck('outliers flagged (both 32 and 20 exceed 15% of the depressed mean)', sr.outliers.length, 2);

console.log('\n-- IS 516 flexural strength --');
let f = IS516.flexuralStrength(20, 600, 150, 150, 250);
ck('a>200 uses PL/bd2 = 3.56', f.value, 3.56, 0.01);
ck('formula primary', f.formula.indexOf('PL')>-1, true);
f = IS516.flexuralStrength(20, 600, 150, 150, 180);
ck('170<=a<=200 uses 3Pa/bd2 = 3.20', f.value, 3.20, 0.01);
f = IS516.flexuralStrength(20, 600, 150, 150, 160);
ck('a<170 discarded', f.valid, false);
f = IS516.flexuralStrength(10, 400, 100, 100, 140);
ck('100mm beam a>133 -> PL/bd2 = 4.00', f.value, 4.00, 0.01);

console.log('\n-- IS 5816 split tensile --');
ck('200 kN, 300x150 cyl -> 2.83', IS5816.splitTensile(200,300,150), 2.83, 0.01);

console.log('\n-- IS 456 derived properties --');
ck('Ec for M30 = 5000*sqrt(30) = 27386', IS456.modulusOfElasticity(30), 27386, 1);
ck('fcr for M30 = 0.7*sqrt(30) = 3.83', IS456.flexuralStrengthExpected(30), 3.83, 0.01);

console.log('\n-- IS 1199 fresh concrete --');
ck('compacting factor', IS1199.compactingFactor(30,34,5), 0.86, 0.005);
ck('fresh density 15 litre, 35.4 kg net', IS1199.freshDensity(35.4,15), 2360, 1);
ck('slump 90 -> Medium', IS456.classifySlump(90), 'Medium');
ck('slump 60 -> Low', IS456.classifySlump(60), 'Low');

console.log('\n-- RCPT (ASTM C1202) --');
let q = Durability.rcptCharge(new Array(13).fill(100), 95);
ck('constant 100 mA for 6 h -> 2160 C', q.charge, 2160, 1);
ck('rating Moderate', q.rating, 'Moderate');
q = Durability.rcptCharge(new Array(13).fill(100), 100);
ck('normalised to 95mm from 100mm dia', q.normalised, Math.round(2160*Math.pow(95/100,2)), 1);
ck('900 C -> Very low', Durability.rcptRating(900), 'Very low');
ck('4500 C -> High', Durability.rcptRating(4500), 'High');

console.log('\n-- RCMT (NT Build 492) --');
let r = Durability.rcmtCoefficient(30, 22, 50, 10, 24);
ck('Dnssm approx 4.34', r.value, 4.34, 0.02);
ck('rating band for 4.34 (2.5-5)', r.rating, 'Very high resistance');

console.log('\n-- Water penetration (DIN 1048-5) --');
let w = Durability.waterPenetration([12,18,15], 25);
ck('max depth 18', w.max, 18);
ck('within limit', w.pass, true);

console.log('\n-- IS 2386 / IS 383 aggregates --');
let sa = IS2386.sieveAnalysis([
 {sieve:'4.75 mm', retained:20},{sieve:'2.36 mm', retained:80},
 {sieve:'1.18 mm', retained:150},{sieve:'600 micron', retained:250},
 {sieve:'300 micron', retained:300},{sieve:'150 micron', retained:150},
 {sieve:'Pan', retained:50}]);
ck('sieve total 1000 g', sa.total, 1000);
ck('cum retained on 600 micron', sa.rows[3].cumRetained, 50);
ck('passing 600 micron', sa.rows[3].passing, 50);
ck('zone for 50% passing 600um', IS2386.classifyFineZone({'600 micron':50,'4.75 mm':98,'2.36 mm':90,'1.18 mm':75,'300 micron':20,'150 micron':5}), 'Zone II');
let sg = IS2386.specificGravity(1000, 1020, 380);
ck('apparent sp gr', sg.apparent, 1.61, 0.01);
ck('water absorption 2.0%', sg.absorption, 2.0, 0.01);
ck('impact value fines 45/200', IS2386.percentFines(45,200), 22.5, 0.01);

console.log('\n-- IS 4031 cement --');
ck('mortar cube 115 kN on 5000 mm2 -> 23.0', IS4031.mortarCubeStrength(115), 23, 0.01);
let mw = IS4031.mortarWaterRequirement(30, 1000);
ck('water % = P/4+3 = 10.5', mw.percent, 10.5, 0.01);
ck('fineness retained %', IS4031.finenessBySieving(8,100), 8, 0.01);

console.log('\n============================');
console.log('passed: '+pass+'   failed: '+fail);
process.exit(fail?1:0);
