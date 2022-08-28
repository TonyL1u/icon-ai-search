import { watch, reactive, nextTick } from 'vue';
import { tryOnMounted, createEventHook, useMagicKeys } from '@vueuse/core';
import { fabric } from 'fabric';
import type { EventHookOn } from '@vueuse/core';

export type DrawingType = 'paint' | 'line' | 'rect' | 'ellipse' | 'circle' | 'select' | 'default';
export type WhiteBoardOptions = {
    drawingType?: DrawingType;
    enableDeleteShortcut?: boolean;
    enableCopyShortcut?: boolean;
} & fabric.ICanvasOptions;

export interface CanvasRendererConfig {
    selector?: string;
}
export interface WhiteBoard {
    render(selector: string): void;
    // render(selector: string, config: Omit<CanvasRendererConfig, 'selector'>): void;
    // render(config: CanvasRendererConfig): void;
    setType: (type: DrawingType) => void;
    clear: () => void;
    use: <T extends object>(plugin: (canvas: fabric.Canvas) => T) => T;
    copy: () => void;
    paste: () => void;
    remove: () => void;
    redo: () => void;
    undo: () => void;
    onReady: EventHookOn<fabric.Canvas>;
}
export interface Snapshot {
    action: 'add' | 'remove' | 'scaleX' | 'scaleY' | 'scale' | 'drag' | 'rotate';
    target: fabric.Object;
    original?: Record<string, any>;
    // data: WeakMap<fabric.Object, Record<string, any>>;
}

const OBJECT_BASE_OPTIONS: fabric.IObjectOptions = {
    selectable: false,
    strokeUniform: true,
    cornerSize: 8,
    strokeWidth: 1
};
const LINE_BASE_OPTIONS: fabric.ILineOptions = {
    stroke: 'black',
    strokeLineCap: 'round',
    ...OBJECT_BASE_OPTIONS
};
const RECT_BASE_OPTIONS: fabric.IRectOptions = {
    fill: 'transparent',
    stroke: '#000',
    ...OBJECT_BASE_OPTIONS
};
const ELLIPSE_BASE_OPTIONS: fabric.IEllipseOptions = {
    fill: 'transparent',
    stroke: '#000',
    ...OBJECT_BASE_OPTIONS
};
const CIRCLE_BASE_OPTIONS: fabric.ICircleOptions = {
    fill: 'transparent',
    stroke: '#000',
    ...OBJECT_BASE_OPTIONS
};
function selectionTransform(target: fabric.Object | fabric.ActiveSelection, callback: (target: fabric.Object) => void, afterCallback: { onSelection?: (objects: fabric.Object[]) => void; onObject?: (object: fabric.Object) => void } = {}) {
    if (target.type === 'activeSelection') {
        (target as fabric.ActiveSelection).forEachObject(obj => {
            callback(obj);
        });
        afterCallback.onSelection?.((target as fabric.ActiveSelection).getObjects());
    } else {
        callback(target as fabric.Object);
        afterCallback.onObject?.(target as fabric.Object);
    }
}
function createActiveSelection(target: fabric.Object[]) {
    return new fabric.ActiveSelection(target, { canvas });
}

export function useWhiteBoard(config?: CanvasDrawingConfig): WhiteBoard {
    // some hooks
    const onReadyEventHook = createEventHook<fabric.Canvas>();

    const keys = useMagicKeys();
    const redoSnapshot = new Proxy<Snapshot[]>([], {
        get(target, p, receiver) {
            if (p === 'push') {
                undoSnapshot.length = 0;
            }
            return Reflect.get(target, p, receiver);
        }
    });
    const undoSnapshot: Snapshot[] = [];
    // const redoOperationMap = new WeakMap<fabric.Object, { action: string; original?: Record<string, unknown> }[]>();
    // const redoTargetQueue: fabric.Object[] = [];
    const plugins = [];

    // global config
    const drawingConfig = reactive<CanvasDrawingConfig>({
        type: 'rect',
        ...config
    });

    // create new Canvas
    let canvas: fabric.Canvas;
    let startPoint: fabric.Point | null;
    let currentLine: fabric.Line | null;
    let currentEllipse: fabric.Ellipse | null;
    let currentCircle: fabric.Circle | null;
    let clipboardObject: fabric.Object | null = null;
    let isDown = false;

    // drawing methods
    function drawLine(endPoint: fabric.Point) {
        const { x, y } = endPoint;
        currentLine?.set({ x2: x, y2: y });
    }
    function drawRect(endPoint: fabric.Point) {
        if (startPoint && JSON.stringify(startPoint) !== JSON.stringify(endPoint)) {
            // 创建矩形
            const top = Math.min(startPoint.y, endPoint.y);
            const left = Math.min(startPoint.x, endPoint.x);
            const width = Math.abs(startPoint.x - endPoint.x);
            const height = Math.abs(startPoint.y - endPoint.y);

            // 矩形对象
            const rect = new fabric.Rect({
                top,
                left,
                width,
                height,
                ...RECT_BASE_OPTIONS
            });

            // 将矩形添加到画布上
            canvas.add(rect);

            return rect;
        }
    }
    function drawEllipse(endPoint: fabric.Point) {
        if (startPoint) {
            const rx = Math.abs(startPoint.x - endPoint.x) / 2;
            const ry = Math.abs(startPoint.y - endPoint.y) / 2;
            const top = endPoint.y > startPoint.y ? startPoint.y : startPoint.y - ry * 2;
            const left = endPoint.x > startPoint.x ? startPoint.x : startPoint.x - rx * 2;

            currentEllipse?.set('rx', rx);
            currentEllipse?.set('ry', ry);
            currentEllipse?.set('top', top);
            currentEllipse?.set('left', left);
        }
    }
    function drawCircle(endPoint: fabric.Point) {
        if (startPoint) {
            const radius = Math.min(Math.abs(startPoint.x - endPoint.x), Math.abs(startPoint.y - endPoint.y)) / 2;
            const top = endPoint.y > startPoint.y ? startPoint.y : startPoint.y - radius * 2;
            const left = endPoint.x > startPoint.x ? startPoint.x : startPoint.x - radius * 2;

            currentCircle?.set('radius', radius);
            currentCircle?.set('top', top);
            currentCircle?.set('left', left);
        }
    }
    function hasActiveObject() {
        return !!canvas.getActiveObject();
    }
    function createCanvasEvent() {
        canvas.on('mouse:down', ({ absolutePointer }) => {
            if (!absolutePointer || hasActiveObject()) return;

            startPoint = absolutePointer;
            switch (drawingConfig.type) {
                case 'line':
                    isDown = true;
                    currentLine = new fabric.Line([startPoint.x, startPoint.y, startPoint.x, startPoint.y], LINE_BASE_OPTIONS);
                    canvas.add(currentLine);

                    break;
                case 'ellipse':
                    isDown = true;
                    currentEllipse = new fabric.Ellipse({
                        top: startPoint.y,
                        left: startPoint.x,
                        rx: 0,
                        ry: 0,
                        ...ELLIPSE_BASE_OPTIONS
                    });
                    canvas.add(currentEllipse);

                    break;
                case 'circle':
                    isDown = true;
                    currentCircle = new fabric.Circle({
                        top: startPoint.y,
                        left: startPoint.x,
                        radius: 0,
                        ...CIRCLE_BASE_OPTIONS
                    });
                    currentCircle.setControlsVisibility({
                        mtr: false,
                        mt: false,
                        mr: false,
                        mb: false,
                        ml: false
                    });
                    canvas.add(currentCircle);

                    break;
            }
        });

        canvas.on('mouse:move', ({ absolutePointer }) => {
            if (!absolutePointer || !isDown) return;

            switch (drawingConfig.type) {
                case 'line':
                    drawLine(absolutePointer);

                    break;
                case 'ellipse':
                    drawEllipse(absolutePointer);

                    break;
                case 'circle':
                    drawCircle(absolutePointer);

                    break;
            }

            canvas.requestRenderAll();
        });

        canvas.on('mouse:up', ({ absolutePointer }) => {
            if (!absolutePointer || hasActiveObject()) return;

            let target: fabric.Object | null = null;
            switch (drawingConfig.type) {
                case 'rect':
                    const rect = drawRect(absolutePointer);
                    if (rect) {
                        canvas.setActiveObject(rect);
                        canvas.skipTargetFind = false;
                        target = rect;
                    }

                    break;
                case 'line':
                    isDown = false;
                    if (currentLine && JSON.stringify(startPoint) === JSON.stringify(absolutePointer)) {
                        canvas.remove(currentLine);
                    } else {
                        canvas.setActiveObject(currentLine!);
                        canvas.skipTargetFind = false;
                        target = currentLine;
                    }

                    break;
                case 'ellipse':
                    isDown = false;
                    if (currentEllipse && JSON.stringify(startPoint) === JSON.stringify(absolutePointer)) {
                        canvas.remove(currentEllipse);
                    } else {
                        canvas.setActiveObject(currentEllipse!);
                        canvas.skipTargetFind = false;
                        target = currentEllipse;
                    }

                    break;
                case 'circle':
                    isDown = false;
                    if (currentCircle && JSON.stringify(startPoint) === JSON.stringify(absolutePointer)) {
                        canvas.remove(currentCircle);
                    } else {
                        canvas.setActiveObject(currentCircle!);
                        canvas.skipTargetFind = false;
                        target = currentCircle;
                    }

                    break;
            }

            if (target) {
                redoSnapshot.push({
                    action: 'add',
                    target
                });
            }

            canvas.requestRenderAll();
        });

        canvas.on('selection:created', option => {
            console.log(option);
        });

        canvas.on('object:modified', options => {
            const { target } = options;
            const { action, original } = options.transform as fabric.Transform;
            if (target) {
                redoSnapshot.push({
                    action: action as Snapshot['action'],
                    target,
                    original
                });
            }
        });
    }
    function registerKeyboardEvent() {
        const { enableDeleteShortcut, enableCopyShortcut } = drawingConfig;
        if (enableDeleteShortcut) {
            watch(keys['Backspace'], val => {
                val && remove();
            });
        }

        if (enableCopyShortcut) {
            watch(keys['Meta+C'], val => {
                val && copy();
            });

            watch(keys['Meta+V'], val => {
                val && paste();
            });
        }
    }

    // expose methods
    const redo = () => {
        const snapshot = redoSnapshot.pop();

        if (snapshot) {
            let undoOriginal = {};
            const { action, original, target } = snapshot;
            switch (action) {
                case 'scaleX':
                    undoOriginal = { scaleX: target.scaleX, left: target.left };
                    target.set('scaleX', original!.scaleX);
                    target.set('left', original!.left);

                    break;
                case 'scaleY':
                    undoOriginal = { scaleY: target.scaleY, top: target.top };
                    target.set('scaleY', original!.scaleY);
                    target.set('top', original!.top);

                    break;
                case 'scale':
                    undoOriginal = { scaleX: target.scaleX, scaleY: target.scaleY };
                    target.set('scaleX', original!.scaleX);
                    target.set('scaleY', original!.scaleY);
                    target.set('left', original!.left);
                    target.set('top', original!.top);

                    break;
                case 'drag':
                    undoOriginal = { top: target.top, left: target.left };
                    target.set('left', original!.left);
                    target.set('top', original!.top);

                    break;
                case 'rotate':
                    undoOriginal = { angle: target.angle, top: target.top, left: target.left };
                    target.set('angle', original!.angle);
                    target.set('left', original!.left);
                    target.set('top', original!.top);

                    break;
                case 'add':
                    selectionTransform(target, obj => canvas.remove(obj));
                    canvas.discardActiveObject();

                    break;
                case 'remove':
                    selectionTransform(target, obj => canvas.add(obj), {
                        onSelection: objects => {
                            const sel = createActiveSelection(objects);
                            canvas.setActiveObject(sel);
                        }
                    });

                    break;
            }
            target.setCoords();
            undoSnapshot.push({
                action,
                target,
                original: undoOriginal
            });
            canvas.requestRenderAll();
        }
    };
    const undo = () => {
        const snapshot = undoSnapshot.pop();

        if (snapshot) {
            const { action, target, original } = snapshot;

            switch (action) {
                case 'scaleX':
                    target.set('scaleX', original!.scaleX);
                    target.set('left', original!.left);

                    break;
                case 'scaleY':
                    target.set('scaleY', original!.scaleY);
                    target.set('top', original!.top);

                    break;
                case 'scale':
                    target.set('scaleX', original!.scaleX);
                    target.set('scaleY', original!.scaleY);
                    target.set('left', original!.left);
                    target.set('top', original!.top);

                    break;
                case 'drag':
                    target.set('left', original!.left);
                    target.set('top', original!.top);
                    break;
                case 'rotate':
                    target.set('angle', original!.angle);
                    target.set('left', original!.left);
                    target.set('top', original!.top);

                    break;
                case 'add':
                    selectionTransform(target, obj => canvas.add(obj), {
                        onSelection: objects => {
                            const sel = createActiveSelection(objects);
                            canvas.setActiveObject(sel);
                        }
                    });

                    break;
                case 'remove':
                    selectionTransform(target, obj => canvas.remove(obj));
                    canvas.discardActiveObject();

                    break;
            }
            target.setCoords();
            canvas.requestRenderAll();
        }
    };
    const remove = () => {
        const target = canvas.getActiveObject();
        if (target) {
            redoSnapshot.push({ action: 'remove', target });
            selectionTransform(target, obj => canvas.remove(obj));
            canvas.discardActiveObject();
            console.log(redoSnapshot);
        }
    };
    const copy = () => {
        canvas.getActiveObject()?.clone((cloned: fabric.Object) => {
            clipboardObject = cloned;
        });
    };
    const paste = () => {
        clipboardObject?.clone((cloned: fabric.Object | fabric.ActiveSelection) => {
            canvas.discardActiveObject();
            cloned
                .set({
                    left: cloned.left! + 10,
                    top: cloned.top! + 10,
                    evented: true,
                    ...OBJECT_BASE_OPTIONS
                })
                .setCoords();
            cloned.canvas = canvas;
            selectionTransform(cloned, obj => canvas.add(obj));
            clipboardObject!.top! += 10;
            clipboardObject!.left! += 10;
            redoSnapshot.push({
                action: 'add',
                target: cloned
            });
            setType('select');
            canvas.setActiveObject(cloned);
            canvas.requestRenderAll();
        });
    };
    const clear = () => {
        canvas.clear();
        redoSnapshot.length = 0;
        undoSnapshot.length = 0;
    };
    const setType = (type: DrawingType) => {
        drawingConfig.type = type;
        switch (type) {
            case 'select':
                canvas.selectionColor = 'rgba(100, 100, 255, 0.3)';
                canvas.selectionBorderColor = 'rgba(255, 255, 255, 0.3)';
                break;
            case 'rect':
                canvas.selectionColor = 'transparent';
                canvas.selectionBorderColor = 'rgba(0, 0, 0)';
                break;
            case 'line':
                canvas.selectionColor = 'transparent';
                canvas.selectionBorderColor = 'transparent';
                break;
            case 'ellipse':
                canvas.selectionColor = 'transparent';
                canvas.selectionBorderColor = 'transparent';
                break;
            case 'circle':
                canvas.selectionColor = 'transparent';
                canvas.selectionBorderColor = 'transparent';
                break;
        }

        canvas.getObjects().forEach(obj => (obj.selectable = type === 'select'));
        canvas.skipTargetFind = type !== 'select';
        canvas.isDrawingMode = type === 'paint';
        canvas.discardActiveObject();
        canvas.requestRenderAll();
    };
    const render = (selector: string) => {
        tryOnMounted(() => {
            // avoid duplicate rendering
            if (canvas) return;
            canvas = new fabric.Canvas(selector, {
                selectionLineWidth: 1,
                skipTargetFind: true,
                hoverCursor: 'auto'
            });
            createCanvasEvent();
            registerKeyboardEvent();
            onReadyEventHook.trigger(canvas);
            // canvas._objects

            // var circle1 = new fabric.Circle({
            //     radius: 50,
            //     fill: 'red',
            //     left: 0
            // });
            // var circle2 = new fabric.Circle({
            //     radius: 50,
            //     fill: 'green',
            //     left: 100
            // });
            // var circle3 = new fabric.Circle({
            //     radius: 50,
            //     fill: 'blue',
            //     left: 200
            // });

            // canvas.add(circle1, circle2, circle3);

            // var sel = new fabric.ActiveSelection([circle1, circle2, circle3], { canvas });
            // sel.set('scaleX', 2);
            // sel.set('left', 200);
            // canvas.setActiveObject(sel);
            // canvas.requestRenderAll();
            // console.log(sel.getObjects()[0].getCoords());
        });
    };
    const use = <T extends object>(plugin: (canvas: fabric.Canvas) => T) => {
        return plugin(canvas);
    };

    return {
        render,
        setType,
        clear,
        use,
        copy,
        paste,
        remove,
        redo,
        undo,
        onReady: onReadyEventHook.on
    };
}
