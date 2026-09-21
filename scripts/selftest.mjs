/**
 * Self-test: proves the brain is real and the learning rule works.
 *  1. Silent brain produces zero spikes (no fake background activity).
 *  2. Odour input propagates ORN -> PN -> Kenyon cells -> MBONs through the measured wiring.
 *  3. PPL1 punishment depresses KC->approach-MBON synapses and lowers the approach read-out for the SAME odour.
 *  4. Reset restores the measured connectome exactly.
 */
import { FlyBrain } from '../server/brain.mjs';
const b = new FlyBrain();
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } console.log('ok  ', m); };
assert(b.N === 139255, `139,255 neurons loaded (${b.N})`);
assert(b.meta.n_edges > 2.6e6, `${b.meta.n_edges.toLocaleString()} directed connections`);
assert(b.pop.KC.length === 5177 && b.pop.MBON.length === 96, `mushroom body: ${b.pop.KC.length} KCs, ${b.pop.MBON.length} MBONs, ${b.pop.PAM.length} PAM, ${b.pop.PPL1.length} PPL1`);

const quiet = () => { b.v.fill(-52); b.g.fill(0); b.refr.fill(0); for (const x of b.inbuf) x.fill(0); b.resetWindow(); };
quiet(); b.run(200, null, {}); assert(b.totalSpikes === 0, 'silent brain -> 0 spikes (no fabricated activity)');

const odour = [...b.pop.orn['ORN_DM1'], ...b.pop.orn['ORN_VA2']];
const drive = { driveIdx: Int32Array.from(odour), driveP: new Float32Array(odour.length).fill(0.02) };
const present = () => { quiet(); b.run(160, null, drive); b.updateEligibility(160); return b.readMBON(160); };
const r0 = present(); const kcActive = b.pop.KC.filter(i => b.spikeCount[i]).length;
assert(kcActive > 100, `odour -> ${kcActive} Kenyon cells active, MBON approach ${r0.approach.toFixed(0)} / avoid ${r0.avoid.toFixed(0)} Hz`);
const bias0 = (r0.approach - r0.avoid) / (r0.approach + r0.avoid);
for (let k = 0; k < 6; k++) { present(); b.applyDopamine(-0.8, 1); }
const r1 = present(); const bias1 = (r1.approach - r1.avoid) / (r1.approach + r1.avoid);
const ps = b.plasticityStats();
assert(ps.depressed > 100, `punishment depressed ${ps.depressed.toLocaleString()} KC->MBON synapses (${(ps.deviation * 100).toFixed(1)}% deviation)`);
assert(bias1 < bias0, `approach bias fell after punishment: ${bias0.toFixed(3)} -> ${bias1.toFixed(3)}`);
b.resetBrain(); const ps2 = b.plasticityStats();
assert(ps2.deviation === 0 && ps2.depressed === 0, 'reset restores measured connectome exactly');
const blob = b.exportWeights(); assert(b.importWeights(blob), 'weights round-trip through DB blob');
console.log('\nALL TESTS PASSED');
