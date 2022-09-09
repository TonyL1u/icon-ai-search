import { tryOnMounted, createEventHook } from '@vueuse/core';
import { fabric } from 'fabric';
import type { EventHook } from '@vueuse/core';
import { c } from 'meetcode-ui/es/_utils_';

export type PauseableEventHookOn<T = any> = (fn: (param: T) => void) => { pause: () => void; resume: () => void };
export type FabricEvent = 'object:added' | 'object:removed' | 'object:modified';
export type FabricOriginalEventHandler = (fn: (param: fabric.IEvent) => void) => fabric.StaticCanvas;
export type Plugin<T, A extends object = {}> = (context: WhiteBoard, options?: A) => T;
export type DrawingType = 'paint' | 'line' | 'rect' | 'ellipse' | 'circle' | 'select';
export type ExportFileExt = 'jpeg' | 'png' | 'svg' | 'json';
export type ImportFileType = 'image' | 'svg' | 'json';
export type WhiteBoardOptions = {
    drawingType?: DrawingType;
} & fabric.ICanvasOptions;
export interface ExportFileOptions {
    ext: ExportFileExt;
    keepImageBlank?: boolean;
}
export interface ImportFileOptions {
    keepSvgBlank?: boolean;
}

const OBJECT_BASE_OPTIONS: fabric.IObjectOptions = {
    fill: 'transparent',
    stroke: '#000',
    selectable: false,
    strokeUniform: true,
    cornerSize: 8,
    strokeWidth: 1
};

/**
 * A simple event bus
 */
abstract class EventEmitter {
    private readonly _events: Record<string, Function[]>;

    constructor() {
        this._events = Object.create(null);
    }

    emit(evt: string, ...args: unknown[]) {
        if (!this._events[evt]) return false;

        const fns = [...this._events[evt]];
        fns.forEach(fn => {
            fn.apply(this, args);
        });

        return true;
    }

    on(evt: string, fn: (...args: any[]) => void): void {
        if (typeof fn !== 'function') {
            throw new TypeError('The evet-triggered callback must be a function');
        }
        if (!this._events[evt]) {
            this._events[evt] = [fn];
        } else {
            this._events[evt].push(fn);
        }
    }
}

/**
 * White board builtin event hooks
 */
abstract class EventHooks extends EventEmitter {
    protected readonly readyEventHook = createEventHook<fabric.Canvas>();
    protected readonly clearedEventHook = createEventHook<fabric.Canvas>();
    protected readonly groupedEventHook = createEventHook<fabric.Group>();
    protected readonly ungroupedEventHook = createEventHook<fabric.ActiveSelection>();
    protected readonly fabricEventMap = new Map<FabricEvent, EventHook<Partial<fabric.IEvent>>>();

    // custom event
    onReady: PauseableEventHookOn<fabric.Canvas>;
    onCleared: PauseableEventHookOn<fabric.Canvas>;
    onGrouped: PauseableEventHookOn<fabric.Group>;
    onUngrouped: PauseableEventHookOn<fabric.ActiveSelection>;

    // fabric event
    onObjectAdded: PauseableEventHookOn<Partial<fabric.IEvent>>;
    onObjectRemoved: PauseableEventHookOn<Partial<fabric.IEvent>>;
    onObjectModified: PauseableEventHookOn<Partial<fabric.IEvent>>;

    constructor() {
        super();

        ['object:added', 'object:removed', 'object:modified'].forEach(evt => this.fabricEventMap.set(evt as FabricEvent, createEventHook()));

        this.onReady = this.initHook(this.readyEventHook);
        this.onCleared = this.initHook(this.clearedEventHook);
        this.onGrouped = this.initHook(this.groupedEventHook);
        this.onUngrouped = this.initHook(this.ungroupedEventHook);
        this.onObjectAdded = this.initHook(this.fabricEventMap.get('object:added')!);
        this.onObjectRemoved = this.initHook(this.fabricEventMap.get('object:removed')!);
        this.onObjectModified = this.initHook(this.fabricEventMap.get('object:modified')!);
    }

    private initHook<T>(hook: EventHook<T>) {
        return (fn: (param: T) => void) => {
            let pause = () => {};
            const bindEvent = () => {
                pause = hook.on(fn).off;
            };

            bindEvent();

            return { pause, resume: bindEvent };
        };
    }
}

export class WhiteBoard extends EventHooks {
    private canvas: fabric.Canvas | null = null;
    private options: WhiteBoardOptions;
    private startPoint: fabric.Point | null = null;
    private currentObject: fabric.Line | fabric.Rect | fabric.Ellipse | fabric.Circle | null = null;
    private isMouseDown: boolean = false;

    /**
     * Constructor
     * @param selector <canvas> element to initialize instance on
     * @param [options] Options object
     */
    constructor(selector: string, options: WhiteBoardOptions = {}) {
        super();

        this.options = options;
        tryOnMounted(() => {
            this.canvas = new fabric.Canvas(selector, {
                skipTargetFind: true,
                ...this.options
            });
            this.createCanvasEvent();
            this.setType('select');
            this.readyEventHook.trigger(this.canvas);

            fabric.loadSVGFromURL('../../src/assets/vue.svg', (objects, options) => {
                const obj = fabric.util.groupSVGElements(objects, options) as fabric.Object;
                const { left, top } = this.canvas?.getCenter()!;
                const { x, y } = obj.getCenterPoint();
                obj.set('left', left - x);
                obj.set('top', top - y);
                this.add(obj);
            });
        });
    }

    /**
     * Set different painting type
     * @param type
     */
    setType(type: DrawingType) {
        if (!this.canvas) return;

        this.options.drawingType = type;
        if (type === 'select') {
            this.canvas.selectionColor = 'rgba(100, 100, 255, 0.3)';
            this.canvas.selectionBorderColor = 'rgba(255, 255, 255, 0.3)';
        } else {
            this.canvas.selectionColor = 'transparent';
            this.canvas.selectionBorderColor = 'transparent';
        }

        this.canvas.getObjects().forEach(obj => (obj.selectable = type === 'select'));
        this.canvas.skipTargetFind = type !== 'select';
        this.canvas.isDrawingMode = type === 'paint';
        this.discardActiveObject();
        this.requestRenderAll();
    }

    setStroke(width: number) {
        OBJECT_BASE_OPTIONS.strokeWidth = width;
    }

    add(...object: fabric.Object[]) {
        this.canvas?.add(...object);
    }

    /**
     * Remove an active object from canvas
     */
    remove(...object: fabric.Object[]) {
        const target = object.length > 0 ? object : this.canvas?.getActiveObject();

        if (target) {
            WhiteBoard.selectionTransform(target, obj => this.canvas?.remove(obj));
            this.canvas?.discardActiveObject();
        }
    }

    /**
     * Remove all objects
     */
    clear() {
        this.canvas?.clear();
        this.clearedEventHook.trigger(this.canvas!);
    }

    group() {
        const target = this.canvas?.getActiveObject();

        if (target && target.type === 'activeSelection') {
            const group = (target as fabric.ActiveSelection).toGroup();
            this.requestRenderAll();
            this.groupedEventHook.trigger(group);
        }
    }

    ungroup() {
        const target = this.canvas?.getActiveObject();

        if (target && target.type === 'group') {
            const sel = (this.getActiveObject() as fabric.Group)?.toActiveSelection();
            this.requestRenderAll();
            this.ungroupedEventHook.trigger(sel);
        }
    }

    getObjects() {
        return this.canvas?.getObjects();
    }

    getActiveObject() {
        return this.canvas?.getActiveObject();
    }

    setActiveObject(object: fabric.Object) {
        return this.canvas?.setActiveObject(object);
    }

    discardActiveObject() {
        return this.canvas?.discardActiveObject();
    }

    requestRenderAll() {
        return this.canvas?.requestRenderAll();
    }

    getCanvas() {
        return this.canvas;
    }

    /**
     * Destroy current white board instance
     */
    dispose() {
        this.canvas?.dispose();
        this.canvas = null;
    }

    /**
     * Register a plugin
     * @param plugin
     * @param options
     * @returns
     */
    use<T, A extends object>(plugin: Plugin<T, A>, options?: A): T {
        return plugin.call(this, this, options);
    }

    export(name: string, options: ExportFileOptions) {
        const { ext, keepImageBlank = true } = options;
        const reg = name.match(/(.*)\/(.*)/);
        const format = ext ?? reg?.[2] ?? 'png';
        const file = ext ? name : `${name}.${format}`;

        switch (format) {
            case 'svg':
                this.exportAsSvg(file);

                break;
            case 'json':
                this.exportAsJson(file);

                break;
            default:
                let target: fabric.Canvas | fabric.Group | null = null;
                if (keepImageBlank || this.isEmpty) {
                    target = this.getCanvas();
                } else {
                    const clonedObjects: fabric.Object[] = [];
                    this.getObjects()?.forEach(obj => obj.clone((cloned: fabric.Object) => clonedObjects.push(cloned)));
                    target = new fabric.Group(clonedObjects);
                }

                target && this.exportAsImage(file, format, target);
                break;
        }
    }

    import(type: ImportFileType, options: ImportFileOptions = {}) {
        const { keepSvgBlank = false } = options;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = type === 'image' ? '.png, .jpeg' : `.${type}`;
        const fileUploaded = (e: Event) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) {
                switch (type) {
                    case 'image':
                        this.importAsImage(file);

                        break;
                    case 'svg':
                        this.importAsSvg(file, keepSvgBlank);

                        break;
                    case 'json':
                        this.importAsJson(file);

                        break;
                }
            }
        };
        window.addEventListener(
            'focus',
            () => {
                setTimeout(() => {
                    input.removeEventListener('change', fileUploaded);
                }, 500);
            },
            { once: true }
        );

        input.addEventListener('change', fileUploaded, { once: true });
        input.click();
    }

    /**
     * Current active object on canvas
     */
    get activeObject() {
        return this.canvas?.getActiveObject() ?? null;
    }

    get hasActiveObject() {
        return !!this.canvas?.getActiveObject();
    }

    get isDrawingMode() {
        return !!this.canvas?.isDrawingMode;
    }

    get isSelectMode() {
        return this.options.drawingType === 'select';
    }

    get isEmpty() {
        return this.canvas?.getObjects().length === 0;
    }

    private get mouseEventDisabled() {
        return !this.canvas || this.hasActiveObject || this.isDrawingMode || this.isSelectMode;
    }

    private exportAsImage(file: string, format: string, target: fabric.Group | fabric.Canvas) {
        const link = document.createElement('a');
        const base64 = target.toDataURL({ format, enableRetinaScaling: true }) ?? '';

        if (base64) {
            link.href = base64;
            link.download = file;
            link.click();
        }
    }

    private exportAsSvg(file: string) {
        const link = document.createElement('a');
        const svg = this.canvas?.toSVG() ?? '';
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const blobURL = URL.createObjectURL(blob);

        if (blobURL) {
            link.href = blobURL;
            link.download = file;
            link.click();
            URL.revokeObjectURL(blobURL);
        }
    }

    private async exportAsJson(file: string) {
        const link = document.createElement('a');
        const json = this.canvas?.toDatalessJSON(['clipPath', 'eraser']);
        const out = JSON.stringify(json, null, '\t');
        const blob = new Blob([out], { type: 'application/json' });
        const clipboardItemData = { [blob.type]: blob };
        try {
            navigator.clipboard && (await navigator.clipboard.write([new ClipboardItem(clipboardItemData)]));
        } catch (error) {
            console.log(error);
        }
        const blobURL = URL.createObjectURL(blob);

        if (blobURL) {
            link.href = blobURL;
            link.download = file;
            link.click();
            URL.revokeObjectURL(blobURL);
        }
    }

    private importAsImage(file: File) {
        const blobURL = URL.createObjectURL(file);

        fabric.Image.fromURL(blobURL, img => {
            img.scale(0.5);
            const { left, top } = this.canvas?.getCenter()!;
            const { x, y } = img.getCenterPoint();
            img.set('left', left - x);
            img.set('top', top - y);
            this.add(img);

            URL.revokeObjectURL(blobURL);
        });
    }

    private importAsSvg(file: File, keepBlank: boolean) {
        const blobURL = URL.createObjectURL(file);

        fabric.loadSVGFromURL(blobURL, (objects, options, elements?: HTMLElement[], allElements?: HTMLElement[]) => {
            let target: fabric.Object;
            if (keepBlank) {
                target = fabric.util.groupSVGElements(objects, options);
            } else {
                const isCreateByFabric = !!allElements?.[0].innerHTML.includes('Created with Fabric.js');
                target = new fabric.Group(objects.slice(+isCreateByFabric));
            }
            this.add(target);

            URL.revokeObjectURL(blobURL);
        });
    }

    private importAsJson(file: File) {
        const reader = new FileReader();
        reader.readAsText(file, 'utf-8');
        reader.onload = e => {
            const currentObjects = this.canvas?.toObject();
            currentObjects.objects = [...currentObjects.objects, ...(JSON.parse((e.target?.result as string) ?? '{}').objects ?? [])];
            this.canvas?.loadFromJSON(JSON.stringify(currentObjects), () => {});
        };
    }

    private listenEvent(evt: FabricEvent) {
        return this.canvas!.on(evt, this.fabricEventMap.get(evt)?.trigger!);
    }

    private offEvent(evt: FabricEvent) {
        return this.canvas!.off(evt, this.fabricEventMap.get(evt)?.trigger!);
    }

    private createCanvasEvent() {
        if (!this.canvas) return;

        this.canvas.on('mouse:down', ({ absolutePointer }) => {
            this.isMouseDown = true;
            if (!absolutePointer || this.mouseEventDisabled) return;

            const { drawingType } = this.options;
            this.startPoint = absolutePointer;
            const { x, y } = this.startPoint;
            switch (drawingType) {
                case 'line':
                    this.currentObject = new fabric.Line([x, y, x, y], {
                        ...OBJECT_BASE_OPTIONS,
                        stroke: 'black',
                        strokeLineCap: 'round'
                    });

                    break;
                case 'rect':
                    this.currentObject = new fabric.Rect({
                        top: y,
                        left: x,
                        width: 0,
                        height: 0,
                        ...OBJECT_BASE_OPTIONS
                    });

                    break;
                case 'ellipse':
                    this.currentObject = new fabric.Ellipse({
                        top: y,
                        left: x,
                        rx: 0,
                        ry: 0,
                        ...OBJECT_BASE_OPTIONS
                    });

                    break;
                case 'circle':
                    this.currentObject = new fabric.Circle({
                        top: y,
                        left: x,
                        radius: 0,
                        ...OBJECT_BASE_OPTIONS
                    });
                    this.currentObject.setControlsVisibility({
                        mtr: false,
                        mt: false,
                        mr: false,
                        mb: false,
                        ml: false
                    });

                    break;
            }
            this.offEvent('object:added');
            this.add(this.currentObject!);
            this.listenEvent('object:added');
        });

        this.canvas.on('mouse:move', ({ absolutePointer }) => {
            if (!absolutePointer || this.mouseEventDisabled || !this.isMouseDown) return;

            const { drawingType } = this.options;
            switch (drawingType) {
                case 'line':
                    this.drawLine(absolutePointer);

                    break;
                case 'rect':
                    this.drawRect(absolutePointer);

                    break;
                case 'ellipse':
                    this.drawEllipse(absolutePointer);

                    break;
                case 'circle':
                    this.drawCircle(absolutePointer);

                    break;
            }

            this.requestRenderAll();
        });

        this.canvas.on('mouse:up', ({ absolutePointer }) => {
            this.isMouseDown = false;
            if (!absolutePointer || this.mouseEventDisabled) return;

            if (this.currentObject && JSON.stringify(this.startPoint) === JSON.stringify(absolutePointer)) {
                this.offEvent('object:removed');
                this.canvas!.remove(this.currentObject);
                this.listenEvent('object:removed');
            } else if (this.currentObject) {
                this.canvas!.setActiveObject(this.currentObject);
                this.canvas!.skipTargetFind = false;
                this.fabricEventMap.get('object:added')!.trigger({ target: this.currentObject });
                this.currentObject = null;
            }

            this.requestRenderAll();
        });

        this.listenEvent('object:added');
        this.listenEvent('object:removed');
        this.listenEvent('object:modified');
    }

    private drawLine(endPoint: fabric.Point) {
        if (this.currentObject) {
            const { x, y } = endPoint;
            (this.currentObject as fabric.Line).set({ x2: x, y2: y });
        }
    }

    private drawRect(endPoint: fabric.Point) {
        if (this.startPoint && this.currentObject) {
            const { x, y } = this.startPoint;
            const top = Math.min(y, endPoint.y);
            const left = Math.min(x, endPoint.x);
            const width = Math.abs(x - endPoint.x);
            const height = Math.abs(y - endPoint.y);

            (this.currentObject as fabric.Rect).set('top', top);
            (this.currentObject as fabric.Rect).set('left', left);
            (this.currentObject as fabric.Rect).set('width', width);
            (this.currentObject as fabric.Rect).set('height', height);
            this.currentObject.setCoords();
        }
    }

    private drawEllipse(endPoint: fabric.Point) {
        if (this.startPoint && this.currentObject) {
            const { x, y } = this.startPoint;
            const rx = Math.abs(x - endPoint.x) / 2;
            const ry = Math.abs(y - endPoint.y) / 2;
            const top = endPoint.y > y ? y : y - ry * 2;
            const left = endPoint.x > x ? x : x - rx * 2;

            (this.currentObject as fabric.Ellipse).set('rx', rx);
            (this.currentObject as fabric.Ellipse).set('ry', ry);
            (this.currentObject as fabric.Ellipse).set('top', top);
            (this.currentObject as fabric.Ellipse).set('left', left);
            this.currentObject.setCoords();
        }
    }

    private drawCircle(endPoint: fabric.Point) {
        if (this.startPoint && this.currentObject) {
            const { x, y } = this.startPoint;
            const radius = Math.min(Math.abs(x - endPoint.x), Math.abs(y - endPoint.y)) / 2;
            const top = endPoint.y > y ? y : y - radius * 2;
            const left = endPoint.x > x ? x : x - radius * 2;

            (this.currentObject as fabric.Circle).set('radius', radius);
            (this.currentObject as fabric.Circle).set('top', top);
            (this.currentObject as fabric.Circle).set('left', left);
        }
    }

    static selectionTransform(
        target: fabric.Object | fabric.Object[] | fabric.ActiveSelection,
        callback: (target: fabric.Object) => void,
        afterCallback: { onSelection?: (objects: fabric.Object[]) => void; onObject?: (object: fabric.Object) => void } = {}
    ) {
        if (Array.isArray(target)) {
            target.forEach(callback);
        } else if (target.type === 'activeSelection') {
            (target as fabric.ActiveSelection).forEachObject(callback);
            afterCallback.onSelection?.((target as fabric.ActiveSelection).getObjects());
        } else {
            callback(target as fabric.Object);
            afterCallback.onObject?.(target as fabric.Object);
        }
    }

    static createGroup(objects?: fabric.Object[], options?: fabric.IObjectOptions, isAlreadyGrouped?: boolean) {
        return new fabric.Group(objects, options, isAlreadyGrouped);
    }

    static createActiveSelection(objects: fabric.Object[], options: fabric.IObjectOptions) {
        return new fabric.ActiveSelection(objects, options);
    }

    static createLine(points?: number[], options?: fabric.ILineOptions) {
        return new fabric.Line(points, options);
    }

    static createRect(options?: fabric.IRectOptions) {
        return new fabric.Rect(options);
    }

    static createCircle(options?: fabric.ICircleOptions) {
        return new fabric.Circle(options);
    }
}
