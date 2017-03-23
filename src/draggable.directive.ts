import {
  Directive,
  OnInit,
  ElementRef,
  Renderer,
  Output,
  EventEmitter,
  Input,
  OnDestroy,
  OnChanges,
  NgZone,
  SimpleChanges
} from '@angular/core';
import {Subject} from 'rxjs/Subject';
import {Observable} from 'rxjs/Observable';
import 'rxjs/add/observable/merge';
import 'rxjs/add/operator/map';
import 'rxjs/add/operator/mergeMap';
import 'rxjs/add/operator/takeUntil';
import 'rxjs/add/operator/take';
import 'rxjs/add/operator/takeLast';
import 'rxjs/add/operator/pairwise';
import 'rxjs/add/operator/share';
import {DraggableHelper} from './draggableHelper.provider';

export type Coordinates = {x: number, y: number};

export type DragAxis = {x: boolean, y: boolean};

export type SnapGrid = {x?: number, y?: number};

export type ValidateDrag = (coordinates: Coordinates) => boolean;

export interface PointerEvent {
  clientX: number;
  clientY: number;
  event: MouseEvent;
}

const MOVE_CURSOR: string = 'move';

@Directive({
  selector: '[mwlDraggable]'
})
export class Draggable implements OnInit, OnChanges, OnDestroy {

  @Input() dropData: any;

  @Input() dragAxis: DragAxis = {x: true, y: true};

  @Input() dragSnapGrid: SnapGrid = {};

  @Input() ghostDragEnabled: boolean = true;

  @Input() validateDrag: ValidateDrag;

  @Output() dragStart: EventEmitter<Coordinates> = new EventEmitter<Coordinates>();

  @Output() dragging: EventEmitter<Coordinates> = new EventEmitter<Coordinates>();

  @Output() dragEnd: EventEmitter<Coordinates> = new EventEmitter<Coordinates>();

  /**
   * @hidden
   */
  pointerDown: Subject<PointerEvent> = new Subject();

  /**
   * @hidden
   */
  pointerMove: Subject<PointerEvent> = new Subject();

  /**
   * @hidden
   */
  pointerUp: Subject<PointerEvent> = new Subject();

  private eventListenerSubscriptions: {
    mousemove?: Function,
    mousedown?: Function,
    mouseup?: Function,
    mouseenter?: Function,
    mouseleave?: Function
  } = {};

  /**
   * @hidden
   */
  constructor(
    public element: ElementRef,
    private renderer: Renderer,
    private draggableHelper: DraggableHelper,
    private zone: NgZone
  ) {}

  ngOnInit(): void {

    this.checkEventListeners();

    const pointerDrag: Observable<any> = this.pointerDown
      .filter(() => this.canDrag())
      .flatMap((pointerDownEvent: PointerEvent) => {

        this.zone.run(() => {
          this.dragStart.next({x: 0, y: 0});
        });

        this.setCursor(MOVE_CURSOR);

        const currentDrag: Subject<any> = new Subject();

        this.draggableHelper.currentDrag.next(currentDrag);

        const pointerMove: Observable<Coordinates> = this.pointerMove
          .map((pointerMoveEvent: PointerEvent) => {

            pointerMoveEvent.event.preventDefault();

            return {
              currentDrag,
              x: pointerMoveEvent.clientX - pointerDownEvent.clientX,
              y: pointerMoveEvent.clientY - pointerDownEvent.clientY,
              clientX: pointerMoveEvent.clientX,
              clientY: pointerMoveEvent.clientY
            };

          })
          .map((moveData: Coordinates) => {

            if (this.dragSnapGrid.x) {
              moveData.x = Math.floor(moveData.x / this.dragSnapGrid.x) * this.dragSnapGrid.x;
            }

            if (this.dragSnapGrid.y) {
              moveData.y = Math.floor(moveData.y / this.dragSnapGrid.y) * this.dragSnapGrid.y;
            }

            return moveData;
          })
          .map((moveData: Coordinates) => {

            if (!this.dragAxis.x) {
              moveData.x = 0;
            }

            if (!this.dragAxis.y) {
              moveData.y = 0;
            }

            return moveData;
          })
          .filter(({x, y}) => !this.validateDrag || this.validateDrag({x, y}))
          .takeUntil(Observable.merge(this.pointerUp, this.pointerDown));

        pointerMove.takeLast(1).subscribe(({x, y}) => {
          this.zone.run(() => {
            this.dragEnd.next({x, y});
          });
          currentDrag.complete();
          this.setCssTransform(null);
          if (this.ghostDragEnabled) {
            this.renderer.setElementStyle(this.element.nativeElement, 'pointerEvents', null);
          }
        });

        return pointerMove;

      })
      .share();

    Observable
      .merge(
        pointerDrag.take(1).map(value => [, value]),
        pointerDrag.pairwise()
      )
      .filter(([previous, next]) => {
        if (!previous) {
          return true;
        }
        return previous.x !== next.x || previous.y !== next.y;
      })
      .map(([previous, next]) => next)
      .subscribe(({x, y, currentDrag, clientX, clientY}) => {
        this.zone.run(() => {
          this.dragging.next({x, y});
        });
        if (this.ghostDragEnabled) {
          this.renderer.setElementStyle(this.element.nativeElement, 'pointerEvents', 'none');
        }
        this.setCssTransform(`translate(${x}px, ${y}px)`);
        currentDrag.next({
          clientX,
          clientY,
          dropData: this.dropData
        });
      });

  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['dragAxis']) {
      this.checkEventListeners();
    }
  }

  ngOnDestroy(): void {
    this.unsubscribeEventListeners();
    this.pointerDown.complete();
    this.pointerMove.complete();
    this.pointerUp.complete();
  }

  private checkEventListeners(): void {

    const canDrag: boolean = this.canDrag();
    const hasEventListeners: boolean = Object.keys(this.eventListenerSubscriptions).length > 0;

    if (canDrag && !hasEventListeners) {

      this.zone.runOutsideAngular(() => {

        this.eventListenerSubscriptions.mousedown = this.renderer.listen(this.element.nativeElement, 'mousedown', (event: MouseEvent) => {
          this.onPointerDown(event);
        });

        this.eventListenerSubscriptions.mouseup = this.renderer.listenGlobal('document', 'mouseup', (event: MouseEvent) => {
          this.onPointerUp(event);
        });

        this.eventListenerSubscriptions.mouseenter = this.renderer.listen(this.element.nativeElement, 'mouseenter', () => {
          this.onMouseEnter();
        });

        this.eventListenerSubscriptions.mouseleave = this.renderer.listen(this.element.nativeElement, 'mouseleave', () => {
          this.onMouseLeave();
        });

      });

    } else if (!canDrag && hasEventListeners) {
      this.unsubscribeEventListeners();
    }

  }

  private onPointerDown(event: MouseEvent): void {
    if (!this.eventListenerSubscriptions.mousemove) {
      this.eventListenerSubscriptions.mousemove = this.renderer.listenGlobal('document', 'mousemove', (event: MouseEvent) => {
        this.pointerMove.next({event, clientX: event.clientX, clientY: event.clientY});
      });
    }
    this.pointerDown.next({event, clientX: event.clientX, clientY: event.clientY});
  }

  private onPointerUp(event: MouseEvent): void {
    if (this.eventListenerSubscriptions.mousemove) {
      this.eventListenerSubscriptions.mousemove();
      delete this.eventListenerSubscriptions.mousemove;
    }
    this.pointerUp.next({event, clientX: event.clientX, clientY: event.clientY});
  }

  private onMouseEnter(): void {
    this.setCursor(MOVE_CURSOR);
  }

  private onMouseLeave(): void {
    this.setCursor(null);
  }

  private setCssTransform(value: string): void {
    if (this.ghostDragEnabled) {
      this.renderer.setElementStyle(this.element.nativeElement, 'transform', value);
      this.renderer.setElementStyle(this.element.nativeElement, '-webkit-transform', value);
      this.renderer.setElementStyle(this.element.nativeElement, '-ms-transform', value);
      this.renderer.setElementStyle(this.element.nativeElement, '-moz-transform', value);
      this.renderer.setElementStyle(this.element.nativeElement, '-o-transform', value);
    }
  }

  private canDrag(): boolean {
    return this.dragAxis.x || this.dragAxis.y;
  }

  private setCursor(value: string): void {
    this.renderer.setElementStyle(this.element.nativeElement, 'cursor', value);
  }

  private unsubscribeEventListeners(): void {
    Object.keys(this.eventListenerSubscriptions).forEach((type: string) => {
      this.eventListenerSubscriptions[type]();
      delete this.eventListenerSubscriptions[type];
    });
  }

}