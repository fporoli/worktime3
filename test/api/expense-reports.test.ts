import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { nextPipelineStage } from '../../apps/api/src/expense-reports.controller';

test('nextPipelineStage walks the finance pipeline forward one step at a time', () => {
  assert.equal(nextPipelineStage('approved'), 'submitted_processing');
  assert.equal(nextPipelineStage('submitted_processing'), 'processing_finished');
  assert.equal(nextPipelineStage('processing_finished'), 'request_payment');
  assert.equal(nextPipelineStage('request_payment'), 'finished');
});

test('nextPipelineStage refuses stages outside or at the end of the pipeline', () => {
  assert.equal(nextPipelineStage('finished'), null);
  assert.equal(nextPipelineStage('in_preparation'), null);
  assert.equal(nextPipelineStage('submitted'), null);
  assert.equal(nextPipelineStage('rejected'), null);
});
