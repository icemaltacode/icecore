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
  <!-- An icon brings its own grid and says whether it is drawn or filled. The two we drew
       are strokes on a 16-unit box; Python's logo is a filled path on a 32-unit one, and a
       stroke width chosen for the first is a quarter of the weight on the second. Setting
       `stroke-width` on the svg rather than per path also lets one shape opt out - the
       filled radio in the multiple-choice icon does exactly that. -->
  <span class="badge">
    <svg v-if="badge.icon" :viewBox="badge.icon.viewBox" width="13" height="13"
         :fill="badge.icon.filled ? 'currentColor' : 'none'"
         :stroke="badge.icon.filled ? 'none' : 'currentColor'" stroke-width="1.5"
         stroke-linecap="round" stroke-linejoin="round"
         aria-hidden="true" v-html="badge.icon.body"></svg>
    <template v-else>{{ badge.text }}</template>
  </span>
</template>
