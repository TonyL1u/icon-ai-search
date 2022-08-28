import { watch } from 'vue';
import { createEventHook, useMagicKeys } from '@vueuse/core';
import { WhiteBoard } from '../WhiteBoard';
import type { Plugin } from '../WhiteBoard';
import type { EventHookOn } from '@vueuse/core';

interface CopyPluginReturn {
    /**
     * Copy an object
     */
    copy: () => void;
    /**
     * Paste an object
     */
    paste: () => void;
    /**
     * Will trigger after copy
     */
    onCopy: EventHookOn<fabric.Object | null>;
    /**
     * Will trigger after paste
     */
    onPaste: EventHookOn<void>;
}
interface CopyPluginOptions {
    /**
     * Forbid shortcut keys for copy and paste
     *
     * default: `false`
     */
    forbidShortcut?: boolean;
    /**
     * Immediately clean the clipboard object after pasting
     *
     * default: `false`
     */
    once?: boolean;
}

const CopyPlugin: Plugin<CopyPluginReturn, CopyPluginOptions> = function (context, options = {}) {
    const { forbidShortcut = false, once = false } = options;

    let clipboardObject: fabric.Object | null = null;
    const onCopyEventHook = createEventHook<fabric.Object>();
    const onPasteEventHook = createEventHook<void>();
    const copy = () => {
        const target = context.getActiveObject();
        if (target) {
            target.clone((cloned: fabric.Object) => {
                clipboardObject = cloned;
                onCopyEventHook.trigger(cloned);
            });
        }
    };
    const paste = () => {
        if (clipboardObject) {
            clipboardObject.clone((cloned: fabric.Object | fabric.ActiveSelection) => {
                context.discardActiveObject();
                cloned
                    .set({
                        left: cloned.left! + 10,
                        top: cloned.top! + 10,
                        evented: true,
                        selectable: false,
                        strokeUniform: true,
                        cornerSize: 8,
                        strokeWidth: 1
                    })
                    .setCoords();
                cloned.canvas = context.getCanvas()!;

                WhiteBoard.selectionTransform(cloned, obj => context.add(obj));
                clipboardObject!.top! += 10;
                clipboardObject!.left! += 10;

                context.setActiveObject(cloned);
                context.requestRenderAll();

                onPasteEventHook.trigger();
                if (once) {
                    clipboardObject = null;
                }
            });
        }
    };

    if (!forbidShortcut) {
        const keys = useMagicKeys();
        watch(keys['Meta+C'], val => {
            val && copy();
        });

        watch(keys['Meta+V'], val => {
            val && paste();
        });
    }

    return {
        copy,
        paste,
        onCopy: onCopyEventHook.on,
        onPaste: onPasteEventHook.on
    };
};

export default CopyPlugin;
