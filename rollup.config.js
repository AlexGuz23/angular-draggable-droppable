import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import { terser } from 'rollup-plugin-terser';
import replace from 'rollup-plugin-replace';

const input =
  'dist/angular-draggable-droppable/bundles/angular-draggable-droppable.umd.js';

// bundle dom-autoscroller lib so it's not a breaking change for systemjs users
const base = {
  input,
  output: {
    file: input,
    format: 'umd',
    name: 'angular-draggable-droppable',
    sourcemap: true,
    globals: {
      rxjs: 'rxjs',
      'rxjs/operators': 'rxjs.operators',
      '@angular/core': 'ng.core',
      '@angular/common': 'ng.common'
    }
  },
  plugins: [
    replace({
      'var requestAnimationFrame': "var window = typeof window !== \"undefined\" ? window : {};\nvar requestAnimationFrame",
      'window\.setTimeout': 'setTimeout',
      'window\.clearTimeout': 'clearTimeout'
    }),
    resolve({ module: true }),
    commonjs()
  ],
  external: ['@angular/core', '@angular/common', 'rxjs', 'rxjs/operators']
};

export default [
  base,
  {
    ...base,
    output: {
      ...base.output,
      file: base.output.file.replace('.js', '.min.js')
    },
    plugins: [...base.plugins, terser()]
  }
];
