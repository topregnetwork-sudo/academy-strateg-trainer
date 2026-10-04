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
  const base={...production,VERCEL_ENV:'preview',TRAINER_FORM2_PREVIEW_SUPABASE_URL:'https://qovkhpfyuptlkrbgrmsb.supabase.co',TRAINER_FORM2_PREVIEW_SUPABASE_ANON_KEY:'isolated-preview-anon-key'};
  assert.equal(publicConfigFor({...base,VERCEL_GIT_COMMIT_REF:'main'}),null);
  assert.deepEqual(publicConfigFor({...base,VERCEL_GIT_COMMIT_REF:'codex/trainer-preview-35859b0'}),{
    supabaseUrl:'https://qovkhpfyuptlkrbgrmsb.supabase.co',supabaseAnonKey:'isolated-preview-anon-key',preview:true
  });
});

test('Preview rejects every backend except the exact isolated Supabase project',()=>{
  const base={...production,VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'codex/trainer-preview-35859b0'};
  assert.equal(publicConfigFor({...base,TRAINER_FORM2_PREVIEW_SUPABASE_URL:production.SUPABASE_URL,TRAINER_FORM2_PREVIEW_SUPABASE_ANON_KEY:'isolated-key'}),null);
  assert.equal(publicConfigFor({...base,TRAINER_FORM2_PREVIEW_SUPABASE_URL:'https://other-preview.supabase.co',TRAINER_FORM2_PREVIEW_SUPABASE_ANON_KEY:'isolated-key'}),null);
});

test('Preview accepts connector aliases only for the exact isolated project',()=>{
  const url='https://qovkhpfyuptlkrbgrmsb.supabase.co';
  const key='isolated-preview-anon-key';
  assert.deepEqual(publicConfigFor({
    VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'codex/trainer-preview-35859b0',
    TRAINER_FORM2_PREVIEW_SUPABASE_URL:url,TRAINER_FORM2_PREVIEW_SUPABASE_ANON_KEY:key,
    SUPABASE_URL:url,NEXT_PUBLIC_SUPABASE_URL:url,SUPABASE_ANON_KEY:key,NEXT_PUBLIC_SUPABASE_ANON_KEY:key
  }),{supabaseUrl:url,supabaseAnonKey:key,preview:true});
});

test('Production continues to return the existing production public configuration',()=>{
  assert.deepEqual(publicConfigFor({...production,VERCEL_ENV:'production'}),{
    supabaseUrl:production.SUPABASE_URL,supabaseAnonKey:production.NEXT_PUBLIC_SUPABASE_ANON_KEY,preview:false
  });
});
