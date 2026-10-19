// 잦은 상태 갱신 모으기 (2026-10-20 저사양 폰 최적화)
// 스트리밍 자막은 글자 조각(delta)이 초당 수십 번 오는데, 조각마다 setState 를 부르면 통화 화면이 그만큼 다시 그려진다.
// 조각 갱신(reducer)을 쌓아 두었다가 windowMs 안에 모인 것을 한 번의 setState 로 순서대로 적용한다.
// 순서가 중요한 갱신(턴 시작·끝)은 flush() 로 먼저 쌓인 것을 적용한 뒤 바로 setState 하면 된다.
// 외부 의존성 없음 (단위 테스트: e2e/batchedState.test.mjs).

export type Reducer<T> = (state: T) => T;

export type BatchedUpdater<T> = {
  /** 갱신을 쌓는다. windowMs 뒤(또는 flush 때) 한 번에 적용된다 */
  queue(reducer: Reducer<T>): void;
  /** 쌓인 갱신을 지금 적용한다 (쌓인 것이 없으면 아무것도 안 함) */
  flush(): void;
  /** 쌓인 갱신을 버리고 타이머를 멈춘다 (화면을 떠날 때) */
  clear(): void;
};

export function createBatchedUpdater<T>(apply: (reducer: Reducer<T>) => void, windowMs = 100): BatchedUpdater<T> {
  let pending: Reducer<T>[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (pending.length === 0) return;
    const reducers = pending;
    pending = [];
    apply((state) => {
      let next = state;
      for (const reducer of reducers) next = reducer(next);
      return next;
    });
  };

  return {
    queue(reducer) {
      pending.push(reducer);
      if (!timer) timer = setTimeout(flush, windowMs);
    },
    flush,
    clear() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = [];
    },
  };
}
