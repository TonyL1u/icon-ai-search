<script lang="ts" setup>
import { ref, onMounted } from 'vue';

const canvas = ref<HTMLCanvasElement>();

onMounted(() => {
    const ctx = canvas.value?.getContext('2d');
    if (ctx) {
        ctx.scale(2, 2);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;

        ctx.beginPath();
        ctx.moveTo(10, 10);
        ctx.lineTo(290, 10);
        ctx.stroke();
        ctx.closePath();
    }
});
</script>

<template>
    <canvas id="canvas" ref="canvas" width="800" height="400">Your browser does not support the HTML5 canvas tag.</canvas>
</template>

<style lang="scss" scoped>
#canvas {
    border: 1px solid #000;
}
</style>
