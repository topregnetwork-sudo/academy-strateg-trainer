import test from 'node:test';
import assert from 'node:assert/strict';
import { publicConfigFor } from '../lib/public-config.js';

const production={
  SUPABASE_URL:'https://production-project.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY:'production-anon-key',
  SUPABASE_ANON_KEY:'production-anon-key'
};

test('Preview fails closed instead of returning shared production Supabase variables',()=>{
  const config=publicConfigFor({
    ...production,
    VERCEL_ENV:'preview',
    VERCEL_GIT_COMMIT_REF:'codex/trainer-preview-35859b0'
  });
  assert.equal(config,null);
});

test('Preview requires its exact branch and dedicated non-production backend variables',()=>{
  const base={...production,VERCEL_ENV:'preview',TRAINER_FORM2_PREVIEW_SUPABASE_URL:'https://isolated-preview.supabase.co',TRAINER_FORM2_PREVIEW_SUPABASE_ANON_KEY:'isolated-preview-anon-key'};
  assert.equal(publicConfigFor({...base,VERCEL_GIT_COMMIT_REF:'main'}),null);
  assert.deepEqual(publicConfigFor({...base,VERCEL_GIT_COMMIT_REF:'codex/trainer-preview-35859b0'}),{
    supabaseUrl:'https://isolated-preview.supabase.co',supabaseAnonKey:'isolated-preview-anon-key',preview:true
  });
});

test('Preview rejects any dedicated value that aliases the production backend or key',()=>{
  const base={...production,VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'codex/trainer-preview-35859b0'};
  assert.equal(publicConfigFor({...base,TRAINER_FORM2_PREVIEW_SUPABASE_URL:production.SUPABASE_URL,TRAINER_FORM2_PREVIEW_SUPABASE_ANON_KEY:'isolated-key'}),null);
  assert.equal(publicConfigFor({...base,TRAINER_FORM2_PREVIEW_SUPABASE_URL:'https://isolated-preview.supabase.co',TRAINER_FORM2_PREVIEW_SUPABASE_ANON_KEY:production.SUPABASE_ANON_KEY}),null);
});

test('Production continues to return the existing production public configuration',()=>{
  assert.deepEqual(publicConfigFor({...production,VERCEL_ENV:'production'}),{
    supabaseUrl:production.SUPABASE_URL,supabaseAnonKey:production.NEXT_PUBLIC_SUPABASE_ANON_KEY,preview:false
  });
});
