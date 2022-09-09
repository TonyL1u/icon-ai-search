<script setup lang="ts">
// This starter template is using Vue 3 <script setup> SFCs
// Check out https://vuejs.org/api/sfc-script-setup.html#script-setup
import { ref } from 'vue';
import { McSpace, McButton, McPopconfirm, McMessage, McInput, McInputGroup, McPopselect } from 'meetcode-ui';
import { WhiteBoard, Copy, Redo } from './utils';
import type { ExportFileExt, ImportFileType } from './utils/WhiteBoard';
// import * as tf from '@tensorflow/tfjs';

// const model = tf.sequential();
// model.add(tf.layers.dense({ units: 1, inputShape: [1] }));
// model.compile({ loss: 'meanSquaredError', optimizer: 'sgd' });

// // 为训练生成一些合成数据
// const xs = tf.tensor2d([1, 2, 3, 4], [4, 1]);
// const ys = tf.tensor2d([1, 3, 5, 7], [4, 1]);

// // 使用数据训练模型
// model.fit(xs, ys, { epochs: 10 }).then(() => {
//     // 在该模型从未看到过的数据点上使用模型进行推理
//     model.predict(tf.tensor2d([5], [1, 1])).print();
//     //  打开浏览器开发工具查看输出
// });
// const { render, setType, clear, remove, redo, undo, use } = useWhiteBoard({
//     type: 'select',
//     enableDeleteShortcut: true,
//     enableCopyShortcut: true
// });
// const { copy, paste } = use(copyPlugin);
// render('canvas');

const whiteBoard = new WhiteBoard('canvas', {
    hoverCursor: 'auto',
    backgroundColor: '#fff'
});
const { copy, paste, onCopy } = whiteBoard.use(Copy);
const { redo, undo } = whiteBoard.use(Redo);
const fileName = ref('');
const exportExt = ref<ExportFileExt>('png');

const handleImport = (type: ImportFileType) => {
    whiteBoard.import(type, { keepSvgBlank: false });
};
const handleExport = () => {
    if (!fileName.value) {
        McMessage.error('请输入文件名');
    } else {
        whiteBoard.export(fileName.value, {
            ext: exportExt.value,
            keepImageBlank: false
        });
    }
};
onCopy(() => {
    McMessage.success('已复制');
});
</script>

<template>
    <McSpace>
        <McButton @click="whiteBoard.setType('paint')">画笔</McButton>
        <McButton @click="whiteBoard.setType('line')">线条</McButton>
        <McButton @click="whiteBoard.setType('rect')">矩形</McButton>
        <McButton @click="whiteBoard.setType('ellipse')">椭圆</McButton>
        <McButton @click="whiteBoard.setType('circle')">圆</McButton>
        <McButton @click="whiteBoard.setType('select')">选择</McButton>
        <McButton @click="whiteBoard.group()">组合</McButton>
        <McButton @click="whiteBoard.ungroup()">拆分</McButton>
        <McButton @click="whiteBoard.remove()">删除</McButton>
        <McButton @click="copy">复制</McButton>
        <McButton @click="paste">粘贴</McButton>
        <McButton @click="redo">撤销</McButton>
        <McButton @click="undo">恢复</McButton>
        <McPopconfirm content="清空后无法恢复，是否继续？" @confirm="whiteBoard.clear()">
            <McButton>清空</McButton>
        </McPopconfirm>
        <McInput :input-limits="['number']" placeholder="笔宽" @change="val => whiteBoard.setStroke(+val)" />
        <McPopselect
            :options="[
                { label: '从图片导入', value: 'image' },
                { label: '从SVG导入', value: 'svg' },
                { label: '从JSON导入', value: 'json' }
            ]"
            :with-arrow="false"
            @select="handleImport"
        >
            <McButton>导入</McButton>
        </McPopselect>
        <McInputGroup>
            <McInput v-model:value="fileName" placeholder="请输入文件名" clearable />
            <McPopselect
                v-model:value="exportExt"
                :options="[
                    { label: '.png', value: 'png' },
                    { label: '.jpeg', value: 'jpeg' },
                    { label: '.svg', value: 'svg' },
                    { label: '.json', value: 'json' }
                ]"
                :with-arrow="false"
                trigger="click"
            >
                <McButton>.{{ exportExt }}</McButton>
            </McPopselect>
            <McButton @click="handleExport">导出</McButton>
        </McInputGroup>
    </McSpace>
    <canvas id="canvas" width="1200" height="600" style="border: 1px solid" />
</template>

<style scoped>
.logo {
    height: 6em;
    padding: 1.5em;
    will-change: filter;
}
.logo:hover {
    filter: drop-shadow(0 0 2em #646cffaa);
}
.logo.vue:hover {
    filter: drop-shadow(0 0 2em #42b883aa);
}
</style>

<style>
.white-board {
    border: 1px solid #000;
    cursor: url('./assets/pen.svg'), auto;
}
</style>
