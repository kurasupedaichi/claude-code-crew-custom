# Session State Issue Analysis & Solution

## 問題の概要

Claude Code Crew プロジェクトにおいて、セッション状態（IDLE、BUSY、WAITFORINPUT）の遷移が正常に動作せず、すべてのセッションが BUSY 状態でスタックしてしまう問題が発生している。

## 根本原因の特定

### 1. **致命的なバグ：sessionId/worktreePath の混同**

**ファイル**: `server/src/services/sessionManager.ts`
**行数**: 265

```typescript
// 現在のコード（バグ）
const newState = this.detectSessionState(
  cleanData,
  oldState,
  session.worktreePath,  // ❌ 誤：worktreePath を渡している
);

// 正しいコード
const newState = this.detectSessionState(
  cleanData,
  oldState,
  session.id,  // ✅ 正：session.id を渡すべき
);
```

**影響分析**:
- `detectSessionState()` メソッドは `sessionId` パラメータを期待しているが、`worktreePath` が渡されている
- 内部で使用される `waitingWithBottomBorder` Map と `busyTimers` Map が誤ったキーで操作される
- 結果として、状態遷移ロジックが完全に機能しない

### 2. **タイマー管理の破綻**

**ファイル**: `server/src/services/sessionManager.ts`
**行数**: 105-118

```typescript
// 現在のコード（問題あり）
const timer = setTimeout(() => {
  const session = this.sessions.get(sessionId);  // ❌ 誤ったsessionIdで検索
  if (session && session.state === 'busy') {
    session.state = 'idle';
    this.emit('sessionStateChanged', session);
  }
  this.busyTimers.delete(sessionId);
}, 500);
```

**問題点**:
- `sessionId` パラメータが実際は `worktreePath` なので、セッションを見つけられない
- タイマーが発火してもセッション状態が更新されない
- BUSY 状態から IDLE 状態への自動遷移が機能しない

### 3. **クライアント側の状態同期競合**

**ファイル**: `client/src/pages/SessionManager.tsx`
**行数**: 165-207

```typescript
// 現在のコード（競合状態）
const worktree = worktreesRef.current.find(w => {
  const sessionsArray = Array.from(sessions.values()); // ❌ 古い状態を参照
  return sessionsArray.some(s => s.id === session.id && s.worktreePath === w.path);
});
```

**問題点**:
- `session:stateChanged` イベント処理時に古い `sessions` 状態を参照
- 複数のWebSocketイベントが競合して状態が上書きされる可能性
- セッションタイプが undefined の場合の処理不備

## 詳細な技術分析

### A. SessionManager の状態検出ロジック

```typescript
// 問題のあるメソッド署名
private detectSessionState(
  cleanData: string,
  currentState: SessionState,
  sessionId: string,  // ❌ 実際は worktreePath が渡される
): SessionState
```

**内部処理での問題**:
1. `this.waitingWithBottomBorder.get(sessionId)` - 誤ったキーで検索
2. `this.busyTimers.has(sessionId)` - 誤ったキーで検索
3. `this.busyTimers.set(sessionId, timer)` - 誤ったキーで保存

### B. ANSI コード処理の問題

```typescript
// 過度に攻撃的な制御文字除去
.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '')  // ❌ 合法的な制御文字も削除
```

**問題点**:
- 有効な制御文字まで削除してしまう
- 不完全な ANSI シーケンス処理
- パターンマッチングの精度低下

### C. 状態検出パターンの不備

```typescript
// 硬直したパターンマッチング
const hasWaitingPrompt =
  cleanData.includes('│ Do you want') ||
  cleanData.includes('│ Would you like') ||
  // ...
```

**問題点**:
- Claude Code の新しいプロンプト形式に対応していない
- 大文字小文字の処理が不統一
- 偽陽性を引き起こす可能性のある汎用パターン

## 解決策

### 1. **即座に実装すべき修正**

#### A. sessionId パラメータの修正

```typescript
// server/src/services/sessionManager.ts:265
const newState = this.detectSessionState(
  cleanData,
  oldState,
  session.id,  // worktreePath → session.id に変更
);
```

#### B. タイマー管理の改善

```typescript
// server/src/services/sessionManager.ts:107-112
const timer = setTimeout(() => {
  const session = this.sessions.get(sessionId);
  if (session && session.state === 'busy' && session.process) {
    console.log(`[SessionManager] Auto-transitioning session ${sessionId} from busy to idle`);
    session.state = 'idle';
    this.emit('sessionStateChanged', session);
  } else {
    console.log(`[SessionManager] Skipping auto-transition for session ${sessionId} - invalid state or process`);
  }
  this.busyTimers.delete(sessionId);
}, 500);
```

#### C. クライアント側の状態同期修正

```typescript
// client/src/pages/SessionManager.tsx:165-207
newSocket.on('session:stateChanged', (session: Session) => {
  console.log('[Client] Received session:stateChanged event:', session);
  
  // セッション状態を先に更新
  setSessions(prev => new Map(prev).set(session.id, session));
  
  // セッションデータを直接使用（古い状態を参照しない）
  const worktree = worktreesRef.current.find(w => w.path === session.worktreePath);
  
  if (worktree) {
    const previousState = previousStateRef.current.get(session.id);
    // 通知ロジックの処理...
    previousStateRef.current.set(session.id, session.state);
  }
});
```

### 2. **長期的な改善策**

#### A. ログ機能の強化

```typescript
// 状態遷移の詳細ログ
if (newState !== oldState) {
  console.log(`[SessionManager] State transition for ${session.id}: ${oldState} -> ${newState}`);
  console.log(`[SessionManager] Detection details:`, {
    hasWaitingPrompt,
    hasBottomBorder,
    hasEscToInterrupt,
    cleanDataSample: cleanData.substring(0, 100)
  });
}
```

#### B. セッション健全性チェック

```typescript
// 定期的なセッション状態チェック
private checkSessionHealth(): void {
  for (const [sessionId, session] of this.sessions) {
    if (session.state === 'busy') {
      const timer = this.busyTimers.get(sessionId);
      if (!timer) {
        console.warn(`[SessionManager] Found stuck busy session ${sessionId}, forcing to idle`);
        session.state = 'idle';
        this.emit('sessionStateChanged', session);
      }
    }
  }
}
```

#### C. 状態検出パターンの改善

```typescript
// より柔軟なパターンマッチング
private detectWaitingPrompt(cleanData: string): boolean {
  const waitingPatterns = [
    /│\s*Do you want/i,
    /│\s*Would you like/i,
    /Do you want/i,
    /Would you like/i,
    /Continue\?/i,
    /Proceed\?/i,
    /\(y\/n\)/i,
    /\[y\/n\]/i,
    /\d+\.\s*Yes/i,
    /\d+\.\s*No/i
  ];
  
  return waitingPatterns.some(pattern => pattern.test(cleanData));
}
```

## 実装優先順位

### 🔴 **緊急度：高**
1. `sessionId/worktreePath` バグの修正（Line 265）
2. タイマー管理の修正
3. 基本的なログ機能の追加

### 🟡 **緊急度：中**
1. クライアント側状態同期の修正
2. ANSI コード処理の改善
3. セッション健全性チェックの実装

### 🟢 **緊急度：低**
1. 状態検出パターンの改善
2. 包括的なテストケースの追加
3. パフォーマンス最適化

## 検証方法

修正実装後、以下の方法で動作確認を行う：

1. **基本的な状態遷移テスト**
   - Claude Code セッションの開始/停止
   - 各状態（idle、busy、waiting_input）の遷移確認

2. **複数セッションテスト**
   - 複数のworktreeでの同時セッション実行
   - セッション切り替え時の状態保持確認

3. **エラーハンドリングテスト**
   - 異常終了時の状態復旧
   - ネットワーク切断時の状態同期

4. **長時間実行テスト**
   - メモリリークの確認
   - タイマー管理の正常性確認

## 結論

この問題の根本原因は、`sessionId` と `worktreePath` を混同した単純だが致命的なバグにある。このバグにより、セッション状態管理システム全体が機能不全に陥り、すべてのセッションが BUSY 状態でスタックしてしまう。

提案された修正を実装することで、セッション状態の正常な遷移が回復し、システム全体の安定性が大幅に向上することが期待される。