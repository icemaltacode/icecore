<script setup>
/* The badge itself, so the sidebar and the Contents modal cannot draw it differently.
 *
 * THE ROOT ELEMENT CARRIES `badge` ON PURPOSE. Vue's scoped CSS reaches a child
 * component's root, so `.badge` and `.navitem.done .badge` in App.vue - and the matching
 * pair in ContentsModal.vue - land on this span. That is the same mechanism that once laid
 * SlidesStep out at 26x22 by accident; here it is the point, and it is why this component
 * carries no sizing of its own. Each parent keeps styling its own list.
 */
import { computed } from 'vue';
import { badgeFor } from '../badges.js';

const props = defineProps({ row: Object, done: Boolean });
const badge = computed(() => badgeFor(props.row, props.done));
</script>

<template>
  <!-- `stroke-width` is set on the svg rather than per path so a shape can opt out by
       setting its own; the filled radio does exactly that. -->
  <span class="badge">
    <svg v-if="badge.icon" viewBox="0 0 16 16" width="13" height="13"
         fill="none" stroke="currentColor" stroke-width="1.5"
         stroke-linecap="round" stroke-linejoin="round"
         aria-hidden="true" v-html="badge.icon"></svg>
    <template v-else>{{ badge.text }}</template>
  </span>
</template>
