---
title: Notion OAuth 回调
description: LD-Notion 共享 OAuth Redirect URI 着陆页
navbar: false
sidebar: false
aside: false
outline: false
editLink: false
lastUpdated: false
prev: false
next: false
footer: false
---

# Notion OAuth 回调

<div class="ld-oauth-box" :class="boxClass">
  <p class="ld-oauth-title">{{ title }}</p>
  <p class="ld-oauth-detail">{{ detail }}</p>
  <p v-if="hint" class="ld-oauth-hint">{{ hint }}</p>
</div>

<script setup>
import { computed, onMounted, ref } from 'vue'

const title = ref('正在处理授权回调…')
const detail = ref('请稍候，已安装的 LD-Notion 用户脚本 / 扩展会自动读取授权码。')
const hint = ref('')
const status = ref('pending')

const boxClass = computed(() => `is-${status.value}`)

onMounted(() => {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const error = params.get('error')
  const errorDescription = params.get('error_description')
  const oauthState = params.get('state')

  // 注: 不向 opener postMessage —— 脚本在回调页 @run-at document-start 直接捕获 URL 快照
  // (main.js captureCallbackSnapshot → handleRedirectCallback 换票), 无需 message 通道; 见 v3.14.15 安全收窄。

  if (error) {
    status.value = 'error'
    title.value = '授权失败'
    detail.value = errorDescription || error
    hint.value = '请返回 LD-Notion 面板重试，并确认 Notion 集成后台的 Redirect URI 与面板中填写的地址完全一致。'
  } else if (code) {
    status.value = 'success'
    title.value = '授权成功'
    detail.value = '已收到 Notion 授权码。若已安装 LD-Notion，用户脚本 / 扩展会自动完成换票；可关闭本页。'
    hint.value = '请勿手动清除地址栏中的 ?code= 参数，直到脚本完成处理。'
  } else {
    status.value = 'idle'
    title.value = '等待 Notion OAuth 回调'
    detail.value = '此页是全体用户共享的 Redirect URI 着陆页，无需自建网站。'
    hint.value = '请在 Notion「New connection」表单中登记：https://smith-106.github.io/LD-Notion/oauth-callback'
  }

  // Keep query visible long enough for userscript/extension to read.
  // Cosmetic cleanup only after a delay.
  if (code || error) {
    window.setTimeout(() => {
      try {
        const clean = window.location.pathname
        window.history.replaceState({}, document.title, clean)
      } catch (_) { /* ignore */ }
    }, 8000)
  }
})
</script>

<style>
.ld-oauth-box {
  max-width: 36rem;
  margin: 3rem auto;
  padding: 1.5rem 1.75rem;
  border-radius: 12px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  text-align: center;
}
.ld-oauth-title {
  margin: 0 0 0.75rem;
  font-size: 1.35rem;
  font-weight: 650;
}
.ld-oauth-detail,
.ld-oauth-hint {
  margin: 0.4rem 0 0;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  font-size: 0.95rem;
}
.ld-oauth-box.is-success {
  border-color: #3d9a5f;
}
.ld-oauth-box.is-error {
  border-color: #d14b4b;
}
.ld-oauth-box.is-idle,
.ld-oauth-box.is-pending {
  border-color: var(--vp-c-brand-1);
}
</style>

> 面板侧 v3.14.16 起可用「认证方式」单选在 API Key 与 OAuth 间切换；两者可同时填写，仅所选模式用于导出。
