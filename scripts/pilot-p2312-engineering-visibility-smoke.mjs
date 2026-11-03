import assert from 'node:assert/strict';
import { shouldShowEngineeringPanel, shouldShowCctvRequirementInputs, buildEngineeringAssessment } from '../src/engineering/engineeringRules.js';

const empty={checks:[],counts:{total:0,error:0,warning:0,pass:0}};
assert.equal(shouldShowEngineeringPanel(empty,'lighting'),false,'lighting empty quote must hide engineering panel');
assert.equal(shouldShowEngineeringPanel(empty,'smarthome'),true,'smarthome empty quote shows panel');
assert.equal(shouldShowCctvRequirementInputs(empty),false);

const products={
 cam:{id:'cam',name:'Camera IP',attributes:{engineering:{role:'ip_camera',bitrateMbps:4}}},
 nvr:{id:'nvr',name:'NVR 4 kênh',attributes:{engineering:{role:'nvr',maxChannels:4,maxIncomingBandwidthMbps:40}}},
};
const assessment=buildEngineeringAssessment({rooms:[{id:'r',name:'Camera',lines:[{id:'c',productId:'cam',qty:8},{id:'n',productId:'nvr',qty:1}]}],productById:products});
assert.equal(shouldShowEngineeringPanel(assessment,'lighting'),true,'technical content overrides lighting workspace');
assert.equal(shouldShowCctvRequirementInputs(assessment),true,'CCTV checks show storage inputs');
assert.ok(assessment.issues.some(x=>x.ruleCode==='CCTV_NVR_CHANNEL_CAPACITY' && x.title==='Đầu ghi không đủ kênh'));
console.log('✓ RC14 M1 engineering visibility smoke PASS');
