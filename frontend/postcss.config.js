module.exports = {
  plugins: {
    'postcss-import': {},
    'tailwindcss/nesting': {},
    tailwindcss: {},
    autoprefixer: {
      flexbox: 'no-2009',
      grid: 'autoplace'
    },
    'postcss-flexbugs-fixes': {},
    'postcss-preset-env': {
      autoprefixer: {
        flexbox: 'no-2009',
        grid: 'autoplace'
      },
      stage: 3,
      features: {
        'custom-properties': false,
        'nesting-rules': false,
        'color-function': true,
        'custom-media-queries': true,
        'media-query-ranges': true,
        'custom-selectors': true,
        'gap-properties': true,
        'not-pseudo-class': true,
        'focus-visible-pseudo-class': true,
        'focus-within-pseudo-class': true,
        'logical-properties-and-values': true,
        'prefers-color-scheme-query': true,
        'color-mix': true,
        'cascade-layers': true
      }
    },
    ...(process.env.NODE_ENV === 'production' ? {
      cssnano: {
        preset: ['advanced', {
          discardComments: { removeAll: true },
          colormin: false,
          reduceIdents: false,
          zindex: false,
          mergeRules: true,
          mergeLonghand: true,
          cssDeclarationSorter: true,
          minifySelectors: true,
          minifyFontValues: true,
          discardDuplicates: true,
          discardOverridden: true,
          normalizeUrl: true,
          normalizeWhitespace: true,
          uniqueSelectors: true,
          calc: { preserve: false },
          orderedValues: true
        }]
      },
      '@fullhuman/postcss-purgecss': {
        content: [
          './src/pages/**/*.{js,jsx,ts,tsx}',
          './src/components/**/*.{js,jsx,ts,tsx}',
          './src/app/**/*.{js,jsx,ts,tsx}',
          './src/features/**/*.{js,jsx,ts,tsx}',
          './src/layouts/**/*.{js,jsx,ts,tsx}'
        ],
        defaultExtractor: content => content.match(/[\w-/:]+(?<!:)/g) || [],
        safelist: {
          standard: [
            /^[a-z]*[\-\/](?!.*--)/,
            /^(border|text|bg|ring|placeholder|from|to|via)-/,
            /^(hover|focus|active|disabled|group-hover|group-focus|dark):/,
            /^(sm|md|lg|xl|2xl):/,
            /^grid-cols-/,
            /^gap-/,
            /^space-/,
            /^row-span-/,
            /^col-span-/
          ],
          deep: [/monaco-editor/, /rdg/, /recharts/, /tippy/, /toast/],
          greedy: [
            /^react-select/,
            /^react-datepicker/,
            /^react-loading-skeleton/,
            /^swiper/
          ]
        },
        keyframes: true,
        fontFace: true,
        variables: true
      },
      'postcss-sort-media-queries': {
        sort: 'mobile-first'
      }
    } : {})
  }
};
