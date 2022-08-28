import { watch, nextTick } from 'vue';
import { useMagicKeys } from '@vueuse/core';
import { WhiteBoard, Circle } from '../WhiteBoard';
import Copy from './copy';
import type { Plugin } from '../WhiteBoard';

interface Snapshot {
    action: 'add' | 'remove' | 'scaleX' | 'scaleY' | 'scale' | 'drag' | 'rotate';
    target: fabric.Object;
    original?: Record<string, any>;
    // data: WeakMap<fabric.Object, Record<string, any>>;
}

interface RedoPluginReturn {
    redo: () => void;
    undo: () => void;
}

interface RedoPluginOptions {
    forbidShortcut?: boolean;
}
const RedoPlugin: Plugin<RedoPluginReturn, RedoPluginOptions> = function (context, options = {}) {
    const { forbidShortcut = false } = options;

    const redoSnapshot: Snapshot[] = [];
    const undoSnapshot: Snapshot[] = [];
    const recordRedo = (snapshot: Snapshot, clearUndo: boolean = true) => {
        redoSnapshot.push(snapshot);
        if (clearUndo) {
            undoSnapshot.length = 0;
        }
    };
    const recordUndo = (snapshot: Snapshot) => {
        undoSnapshot.push(snapshot);
    };

    context.onCleared(() => {
        redoSnapshot.length = 0;
        undoSnapshot.length = 0;
    });

    context.onObjectModified(options => {
        const { target } = options;
        const { action, original } = options.transform as fabric.Transform;
        if (target) {
            recordRedo({
                action: action as Snapshot['action'],
                target,
                original
            });
        }
    });

    const { pause: pauseAdd, resume: resumeAdd } = context.onObjectAdded(({ target }) => {
        if (target) {
            recordRedo({
                action: 'add',
                target
            });
        }
    });

    const { pause: pauseRemove, resume: resumeRemove } = context.onObjectRemoved(({ target }) => {
        if (target) {
            recordRedo({
                action: 'remove',
                target
            });
        }
    });

    const redo = () => {
        const snapshot = redoSnapshot.pop();

        if (snapshot) {
            pauseRemove();
            pauseAdd();
            let undoOriginal = {};
            const { action, original, target } = snapshot;

            switch (action) {
                case 'add':
                    WhiteBoard.selectionTransform(target, obj => context.remove(obj));
                    context.discardActiveObject();

                    break;
                case 'remove':
                    WhiteBoard.selectionTransform(target, obj => context.add(obj), {
                        onSelection: objects => {
                            const sel = WhiteBoard.createActiveSelection(objects, { canvas: context.getCanvas()! });
                            context.setActiveObject(sel);
                        }
                    });

                    break;
                default:
                    const { angle, scaleX, scaleY, left, top } = target;
                    const { angle: originalAngle, scaleX: originalScaleX, scaleY: originScaleY, left: originalLeft, top: originalTop } = original ?? {};
                    undoOriginal = { angle, scaleX, scaleY, left, top };

                    target.set('angle', originalAngle);
                    target.set('scaleX', originalScaleX);
                    target.set('scaleY', originScaleY);
                    target.set('left', originalLeft);
                    target.set('top', originalTop);

                    break;
            }
            target.setCoords();
            recordUndo({
                action,
                target,
                original: undoOriginal
            });
            context.requestRenderAll();

            resumeAdd();
            resumeRemove();
        }
    };
    const undo = () => {
        const snapshot = undoSnapshot.pop();

        if (snapshot) {
            pauseRemove();
            pauseAdd();
            let redoOriginal = {};
            const { action, target, original } = snapshot;

            switch (action) {
                case 'add':
                    WhiteBoard.selectionTransform(target, obj => context.add(obj), {
                        onSelection: objects => {
                            const sel = WhiteBoard.createActiveSelection(objects, { canvas: context.getCanvas()! });
                            context.setActiveObject(sel);
                        }
                    });

                    break;
                case 'remove':
                    WhiteBoard.selectionTransform(target, obj => context.remove(obj));
                    context.discardActiveObject();
                    resumeRemove();

                    break;
                default:
                    const { angle, scaleX, scaleY, left, top } = target;
                    const { angle: originalAngle, scaleX: originalScaleX, scaleY: originScaleY, left: originalLeft, top: originalTop } = original ?? {};
                    redoOriginal = { angle, scaleX, scaleY, left, top };

                    target.set('angle', originalAngle);
                    target.set('scaleX', originalScaleX);
                    target.set('scaleY', originScaleY);
                    target.set('left', originalLeft);
                    target.set('top', originalTop);

                    break;
            }
            target.setCoords();
            recordRedo(
                {
                    action,
                    target,
                    original: redoOriginal
                },
                false
            );
            context.requestRenderAll();

            resumeAdd();
            resumeRemove();
        }
    };

    if (!forbidShortcut) {
        const keys = useMagicKeys();
        watch(keys['Meta+Z'], val => {
            val && redo();
        });

        watch(keys['Meta+Shift+Z'], val => {
            val && undo();
        });
    }

    return { redo, undo };
};

export default RedoPlugin;
