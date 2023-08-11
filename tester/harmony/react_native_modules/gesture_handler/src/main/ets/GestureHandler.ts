import type { GestureHandlerOrchestrator } from "./GestureHandlerOrchestrator"
import type { PointerTracker } from "./PointerTracker"
import type { View } from "./View"
import type { EventDispatcher } from "./EventDispatcher"
import type { InteractionManager } from "./InteractionManager"
import { State } from "./State"
import { HitSlop, Directions, AdaptedEvent, PointerType, TouchEventType, EventType } from "./Event"
import { GestureStateChangeEvent, GestureTouchEvent, TouchData } from "./OutgoingEvent"


export interface Handler {
  handlerTag: number;
}

export interface GestureConfig {
  enabled?: boolean;
  simultaneousHandlers?: Handler[] | null;
  waitFor?: Handler[] | null;
  hitSlop?: HitSlop;
  shouldCancelWhenOutside?: boolean;
  activateAfterLongPress?: number;
  failOffsetXStart?: number;
  failOffsetYStart?: number;
  failOffsetXEnd?: number;
  failOffsetYEnd?: number;
  activeOffsetXStart?: number;
  activeOffsetXEnd?: number;
  activeOffsetYStart?: number;
  activeOffsetYEnd?: number;
  minPointers?: number;
  maxPointers?: number;
  minDist?: number;
  minDistSq?: number;
  minVelocity?: number;
  minVelocityX?: number;
  minVelocityY?: number;
  minVelocitySq?: number;
  maxDist?: number;
  maxDistSq?: number;
  numberOfPointers?: number;
  minDurationMs?: number;
  numberOfTaps?: number;
  maxDurationMs?: number;
  maxDelayMs?: number;
  maxDeltaX?: number;
  maxDeltaY?: number;
  shouldActivateOnStart?: boolean;
  disallowInterruption?: boolean;
  direction?: typeof Directions;
  needsPointerData?: boolean
  // --- Tap
  minNumberOfPointers?: number
}

type PointerId = number


export type GestureHandlerDependencies = {
  handlerTag: number
  orchestrator: GestureHandlerOrchestrator
  tracker: PointerTracker
  eventDispatcher: EventDispatcher
  interactionManager: InteractionManager
}

export abstract class GestureHandler {
  protected config: GestureConfig = {}
  protected currentState: State = State.UNDETERMINED
  protected view: View | undefined = undefined
  protected lastSentState: State | undefined = undefined
  protected shouldCancelWhenOutside = false
  protected handlerTag: number
  protected orchestrator: GestureHandlerOrchestrator
  protected tracker: PointerTracker
  protected eventDispatcher: EventDispatcher
  protected interactionManager: InteractionManager

  protected isActivated = false
  protected isAwaiting_ = false
  protected pointerType: PointerType
  protected activationIndex = 0
  protected shouldResetProgress = false;

  constructor(deps: GestureHandlerDependencies
  ) {
    this.handlerTag = deps.handlerTag
    this.orchestrator = deps.orchestrator
    this.tracker = deps.tracker
    this.eventDispatcher = deps.eventDispatcher
    this.interactionManager = deps.interactionManager
  }

  public onPointerDown(e: AdaptedEvent) {
    this.orchestrator.registerHandlerIfNotPresent(this);
    this.pointerType = e.pointerType;
    if (this.pointerType === PointerType.TOUCH) {
      this.orchestrator.cancelMouseAndPenGestures(this);
    }
    if (this.config.needsPointerData) {
      this.sendTouchEvent(e);
    }
  }

  protected sendTouchEvent(e: AdaptedEvent) {
    if (!this.config.enabled) {
      return;
    }


    const touchEvent: GestureTouchEvent | undefined =
    this.transformToTouchEvent(e);

    if (touchEvent) {
      this.eventDispatcher.onGestureHandlerEvent(touchEvent)
    }
  }

  protected transformToTouchEvent(event: AdaptedEvent): GestureTouchEvent | undefined {
    const rect = this.view.getBoundingRect();

    const all: TouchData[] = [];
    const changed: TouchData[] = [];

    const trackerData = this.tracker.getData();

    // This if handles edge case where all pointers have been cancelled
    // When pointercancel is triggered, reset method is called. This means that tracker will be reset after first pointer being cancelled
    // The problem is, that handler will receive another pointercancel event from the rest of the pointers
    // To avoid crashing, we don't send event if tracker tracks no pointers, i.e. has been reset
    if (trackerData.size === 0 || !trackerData.has(event.pointerId)) {
      return;
    }

    trackerData.forEach((element, key): void => {
      const id: number = this.tracker.getMappedTouchEventId(key);

      all.push({
        id: id,
        x: element.lastX - rect.x,
        y: element.lastY - rect.y,
        absoluteX: element.lastX,
        absoluteY: element.lastY,
      });
    });

    // Each pointer sends its own event, so we want changed touches to contain only the pointer that has changed.
    // However, if the event is cancel, we want to cancel all pointers to avoid crashes
    if (event.eventType !== EventType.CANCEL) {
      changed.push({
        id: this.tracker.getMappedTouchEventId(event.pointerId),
        x: event.x - rect.x,
        y: event.y - rect.y,
        absoluteX: event.x,
        absoluteY: event.y,
      });
    } else {
      trackerData.forEach((element, key: number): void => {
        const id: number = this.tracker.getMappedTouchEventId(key);

        changed.push({
          id: id,
          x: element.lastX - rect.x,
          y: element.lastY - rect.y,
          absoluteX: element.lastX,
          absoluteY: element.lastY,
        });
      });
    }

    let eventType: TouchEventType = TouchEventType.UNDETERMINED;

    switch (event.eventType) {
      case EventType.DOWN:
      case EventType.ADDITIONAL_POINTER_DOWN:
        eventType = TouchEventType.DOWN;
        break;
      case EventType.UP:
      case EventType.ADDITIONAL_POINTER_UP:
        eventType = TouchEventType.UP;
        break;
      case EventType.MOVE:
        eventType = TouchEventType.MOVE;
        break;
      case EventType.CANCEL:
        eventType = TouchEventType.CANCELLED;
        break;
    }

    // Here, when we receive up event, we want to decrease number of touches
    // That's because we want handler to send information that there's one pointer less
    // However, we still want this pointer to be present in allTouches array, so that its data can be accessed
    let numberOfTouches: number = all.length;

    if (
      event.eventType === EventType.UP ||
        event.eventType === EventType.ADDITIONAL_POINTER_UP
    ) {
      --numberOfTouches;
    }

    return {
      nativeEvent: {
        handlerTag: this.handlerTag,
        state: this.currentState,
        eventType: event.touchEventType ?? eventType,
        changedTouches: changed,
        allTouches: all,
        numberOfTouches: numberOfTouches,
      },
      timeStamp: Date.now(),
    };
  }

  public onPointerUp(e: AdaptedEvent): void {
    if (this.config.needsPointerData) this.sendTouchEvent(e)
  }

  public onAdditionalPointerAdd(e: AdaptedEvent): void {
    if (this.config.needsPointerData) this.sendTouchEvent(e)
  }

  public onAdditionalPointerRemove(e: AdaptedEvent): void {
    if (this.config.needsPointerData) this.sendTouchEvent(e)
  }

  public onPointerMove(e: AdaptedEvent): void {
    this.tryToSendMoveEvent(false);
    if (this.config.needsPointerData) {
      this.sendTouchEvent(e);
    }
  }

  private tryToSendMoveEvent(out: boolean): void {
    if (
      this.config.enabled &&
      this.isActivated &&
        (!out || (out && !this.shouldCancelWhenOutside))
    ) {
      this.sendEvent({ newState: this.currentState, oldState: this.currentState });
    }
  }

  public onPointerEnter(e: AdaptedEvent): void {
    if (this.config.needsPointerData) {
      this.sendTouchEvent(e)
    }
  }

  public onPointerOut(e: AdaptedEvent): void {
    if (this.shouldCancelWhenOutside) {
      switch (this.currentState) {
        case State.ACTIVE:
          this.cancel();
          break;
        case State.BEGAN:
          this.fail();
          break;
      }
      return;
    }
    if (this.config.needsPointerData) {
      this.sendTouchEvent(e);
    }
  }

  public onPointerCancel(e: AdaptedEvent): void {
    if (this.config.needsPointerData) {
      this.sendTouchEvent(e);
    }
    this.cancel();
    this.reset();
  }

  public onPointerOutOfBounds(e: AdaptedEvent): void {
    this.tryToSendMoveEvent(true);
    if (this.config.needsPointerData) {
      this.sendTouchEvent(e);
    }
  }

  public onViewAttached(view: View) {
    this.view = view
  }

  public getTag(): number {
    return this.handlerTag
  }

  public getTracker() {
    return this.tracker
  }

  public getView() {
    return this.view
  }

  protected begin(): void {
    if (!this.isWithinHitSlop()) return;
    if (this.currentState === State.UNDETERMINED) {
      this.moveToState(State.BEGAN);
    }
  }

  private isWithinHitSlop(): boolean {
    if (!this.config.hitSlop) {
      return true;
    }

    const width = this.view.getBoundingRect().width;
    const height = this.view.getBoundingRect().height;

    let left = 0;
    let top = 0;
    let right: number = width;
    let bottom: number = height;

    if (this.config.hitSlop.horizontal !== undefined) {
      left -= this.config.hitSlop.horizontal;
      right += this.config.hitSlop.horizontal;
    }

    if (this.config.hitSlop.vertical !== undefined) {
      top -= this.config.hitSlop.vertical;
      bottom += this.config.hitSlop.vertical;
    }

    if (this.config.hitSlop.left !== undefined) {
      left = -this.config.hitSlop.left;
    }

    if (this.config.hitSlop.right !== undefined) {
      right = width + this.config.hitSlop.right;
    }

    if (this.config.hitSlop.top !== undefined) {
      top = -this.config.hitSlop.top;
    }

    if (this.config.hitSlop.bottom !== undefined) {
      bottom = width + this.config.hitSlop.bottom;
    }
    if (this.config.hitSlop.width !== undefined) {
      if (this.config.hitSlop.left !== undefined) {
        right = left + this.config.hitSlop.width;
      } else if (this.config.hitSlop.right !== undefined) {
        left = right - this.config.hitSlop.width;
      }
    }

    if (this.config.hitSlop.height !== undefined) {
      if (this.config.hitSlop.top !== undefined) {
        bottom = top + this.config.hitSlop.height;
      } else if (this.config.hitSlop.bottom !== undefined) {
        top = bottom - this.config.hitSlop.height;
      }
    }

    const rect = this.view.getBoundingRect();
    const offsetX: number = this.tracker.getLastX() - rect.x;
    const offsetY: number = this.tracker.getLastY() - rect.y;

    if (
      offsetX >= left &&
        offsetX <= right &&
        offsetY >= top &&
        offsetY <= bottom
    ) {
      return true;
    }
    return false;
  }

  protected activate(): void {
    if (this.currentState === State.UNDETERMINED || this.currentState === State.BEGAN) {
      this.moveToState(State.ACTIVE)
    }
  }

  protected moveToState(state: State) {
    if (state === this.currentState) return;
    const oldState = this.currentState
    this.currentState = state;
    if (this.tracker.getTrackedPointersCount() > 0 && this.config.needsPointerData && this.isFinished()) {
      this.cancelTouches()
    }
    this.orchestrator.onHandlerStateChange(this, state, oldState)
    this.stateDidChange(state, oldState)
  }

  private isFinished() {
    return (
      this.currentState === State.END ||
        this.currentState === State.FAILED ||
        this.currentState === State.CANCELLED
    );
  }

  private cancelTouches(): void {
    const rect = this.view.getBoundingRect();
    const all: TouchData[] = [];
    const changed: TouchData[] = [];
    const trackerData = this.tracker.getData();
    if (trackerData.size === 0) {
      return;
    }
    trackerData.forEach((element, key): void => {
      const id: number = this.tracker.getMappedTouchEventId(key);
      all.push({
        id: id,
        x: element.lastX - rect.x,
        y: element.lastY - rect.y,
        absoluteX: element.lastX,
        absoluteY: element.lastY,
      });
      changed.push({
        id: id,
        x: element.lastX - rect.x,
        y: element.lastY - rect.y,
        absoluteX: element.lastX,
        absoluteY: element.lastY,
      });
    });
    const cancelEvent: GestureTouchEvent = {
      nativeEvent: {
        handlerTag: this.handlerTag,
        state: this.currentState,
        eventType: TouchEventType.CANCELLED,
        changedTouches: changed,
        allTouches: all,
        numberOfTouches: all.length,
      },
      timeStamp: Date.now(),
    };
    this.eventDispatcher.onGestureHandlerEvent(cancelEvent)
  }

  protected stateDidChange(newState: State, oldState: State) {
  }


  public updateGestureConfig(config: GestureConfig): void {
    this.config = config
  }

  protected resetConfig(): void {
    this.config = this.getDefaultConfig()
  }

  abstract getDefaultConfig(): GestureConfig


  public isEnabled(): boolean {
    return Boolean(this.config.enabled)
  }

  public isActive(): boolean {
    return this.isActivated
  }

  public cancel(): void {
    if (
      this.currentState === State.ACTIVE ||
        this.currentState === State.UNDETERMINED ||
        this.currentState === State.BEGAN
    ) {
      this.onCancel();
      this.moveToState(State.CANCELLED);
    }
  }

  protected onCancel(): void {
  }

  protected onReset(): void {
  }

  protected resetProgress(): void {
  }

  public getState(): State {
    return this.currentState
  }

  public sendEvent({newState, oldState}: {
    oldState: State,
    newState: State
  }): void {
    const stateChangeEvent = this.createStateChangeEvent(newState, oldState);
    if (this.lastSentState !== newState) {
      this.lastSentState = newState;
      this.eventDispatcher.onGestureHandlerStateChange(stateChangeEvent);
    }
    if (this.currentState === State.ACTIVE) {
      stateChangeEvent.nativeEvent.oldState = undefined;
      this.eventDispatcher.onGestureHandlerEvent(stateChangeEvent);
    }
  }

  private createStateChangeEvent(newState: State, oldState: State): GestureStateChangeEvent {
    return {
      nativeEvent: {
        numberOfPointers: this.tracker.getTrackedPointersCount(),
        state: newState,
        pointerInside: this.view.isPositionInBounds({
          x: this.tracker.getLastAvgX(),
          y: this.tracker.getLastAvgY(),
        }),
        ...this.transformNativeEvent(),
        handlerTag: this.handlerTag,
        target: this.view.getTag(),
        oldState: newState !== oldState ? oldState : undefined,
      },
      timeStamp: Date.now(),
    };
  }

  protected transformNativeEvent() {
    return {};
  }

  setAwaiting(isAwaiting: boolean): void {
    this.isAwaiting_ = isAwaiting
  }

  shouldWaitForHandlerFailure(handler: GestureHandler): boolean {
    if (handler === this)
      return false;
    return this.interactionManager.shouldWaitForHandlerFailure(this, handler);
  }

  shouldRequireToWaitForFailure(handler: GestureHandler): boolean {
    if (handler === this)
      return false;
    return this.interactionManager.shouldRequireHandlerToWaitForFailure(this, handler);
  }

  shouldWaitFor(otherHandler: GestureHandler): boolean {
    return (
      this !== otherHandler &&
        (this.shouldWaitForHandlerFailure(otherHandler) ||
        otherHandler.shouldRequireToWaitForFailure(this))
    );
  }

  reset(): void {
    this.tracker.resetTracker();
    this.onReset();
    this.resetProgress();
    // TODO: reset ArkUIAdapters
    // this.eventManagers.forEach((manager: EventManager) =>
    // manager.resetManager()
    // );
    this.currentState = State.UNDETERMINED;
  }

  isAwaiting(): boolean {
    return this.isAwaiting_
  }

  setActive(isActivated: boolean): void {
    this.isActivated = isActivated
  }

  setActivationIndex(value: number): void {
    this.activationIndex = value
  }

  setShouldResetProgress(value: boolean): void {
    this.shouldResetProgress = value;
  }

  fail(): void {
    if (
      this.currentState === State.ACTIVE ||
        this.currentState === State.BEGAN
    ) {
      this.moveToState(State.FAILED);
    }
    this.resetProgress();
  }

  shouldBeCancelledByOther(otherHandler: GestureHandler): boolean {
    if (otherHandler === this)
      return false;
    return this.interactionManager.shouldHandlerBeCancelledBy(this, otherHandler);
  }

  getTrackedPointersID(): PointerId[] {
    return this.tracker.getTrackedPointersID()
  }

  shouldRecognizeSimultaneously(otherHandler: GestureHandler): boolean {
    if (otherHandler === this)
      return true;
    return this.interactionManager.shouldRecognizeSimultaneously(this, otherHandler);
  }

  public getPointerType(): PointerType {
    return this.pointerType
  }

  protected setShouldCancelWhenOutside(shouldCancel: boolean) {
    this.shouldCancelWhenOutside = shouldCancel
  }
}
