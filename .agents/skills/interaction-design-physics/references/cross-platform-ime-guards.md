# 跨平台输入法合成态守卫与事件生命周期 (Cross-Platform IME Guards)

## 一、 中日韩输入法 (IME) 的交互陷阱

在使用中文、日文、韩文等输入法（Pinyin / Romaji / Hangul）时，用户敲击键盘时并非直接生成目标字符，而是先进入操作系统的输入法组合态（Composition Session），浮出候选词窗口。

在此期间，浏览器的按键生命周期与常规英文输入存在巨大差异：
1. 敲击字母键时，浏览器触发 `compositionstart` 与连续的 `compositionupdate`；
2. 用户按下数字键或 `Enter` 键确认汉字候选词时，会触发一个 `keydown` 事件；
3. 在大部分现代浏览器与 Electron 宿主中，候选词回车时的 `e.isComposing` 可能已经开始重置，但 `e.keyCode === 229`（标准 IME 未决键码）；
4. **灾难性后果**：如果前端仅简单监听 `if (e.key === 'Enter') handleSend()`，用户按回车仅仅是为了“把拼音变成汉字”，却导致整个草稿直接被提前误发送出去！

---

## 二、 双重互锁守卫状态机 (Double-Interlock State Machine)

为彻底杜绝误发送，必须构建严格的双重互锁判定准则：

$$\text{CanSubmit} = (\text{Key} == \text{'Enter'}) \land (\neg \text{ShiftKey}) \land (\neg \text{isComposing}) \land (\text{keyCode} \neq 229)$$

### 标准 TypeScript 拦截实现：
```typescript
function handleComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
  // 1. 守卫：判断是否处于输入法合成未决态
  const isImePending = Boolean(
    e.nativeEvent.isComposing || 
    e.isComposing || 
    e.keyCode === 229
  );

  // 2. Escape 键安全解耦：关闭候选词浮层时不向外冒泡关闭整个模态弹窗
  if (e.key === 'Escape') {
    if (isImePending) {
      e.stopPropagation();
      return;
    }
    // 正常退出逻辑
    return;
  }

  // 3. Enter 键提交判定：在合成期强制静默拦截
  if (e.key === 'Enter' && !e.shiftKey) {
    if (isImePending) {
      // 正在挑选候选词，绝对禁止提交！
      return;
    }
    
    // 允许正常提交
    if (!e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      executeSendMessage();
    }
  }
}
```

---

## 三、 移动端与 Webview 宿主特别注意事项

1. **iOS WebKit 16px 缩放底线**：
   在移动端或 Safari/WebKit 宿主中，任何输入框的 `font-size < 16px` 在获得焦点时，均会触发系统强制页面放大破坏视口排版。因此输入框字体大小必须声明：
   ```css
   font-size: max(16px, var(--font-size-body));
   ```
2. **`field-sizing: content` 高度自适应与平滑滚动**：
   现代 CSS 提供了原生的 `field-sizing: content` 属性，能够让文本框随着输入行数自动自适应撑开，彻底取代依赖 JavaScript 频繁读取 `scrollHeight` 触发重排的陈旧方案。
