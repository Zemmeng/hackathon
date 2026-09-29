// worker.js —— Cloudflare Worker 入口：把 prompts.md 原样打进来（wrangler.jsonc 的 Text 规则），逻辑全在 app.js
import PROMPTS_MD from '../prompts.md';
import { makeApp } from './app.js';

export default makeApp({ promptsMd: PROMPTS_MD });
