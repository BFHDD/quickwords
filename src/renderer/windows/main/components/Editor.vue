<template>
    <div id="editor"></div>
</template>

<script>
    import Vue from 'vue'

    import ace from 'brace'
    import 'brace/ext/statusbar'
    import 'brace/ext/language_tools'
    import 'brace/mode/javascript'
    import 'brace/mode/lua'
    import 'brace/theme/chrome'

    ace.define('ace/theme/qw_dark', ['require', 'exports', 'module', 'ace/lib/dom'], function (acequire, exports) {
        exports.isDark = true
        exports.cssClass = 'ace-qw-dark'
        exports.cssText = ''

        const dom = acequire('../lib/dom')
        dom.importCssString(exports.cssText, exports.cssClass)
    })

    export default {
        props: {
            theme: {
                type: String,
                required: true,
            },
            mode: {
                type: String,
                required: true,
            },
        },
        data() {
            return {
                editor: null,
            }
        },
        mounted() {
            this.editor = ace.edit('editor')
            this.editor.setTheme(`ace/theme/${this.theme}`)
            this.editor.getSession().setMode(`ace/mode/${this.mode}`)
            this.editor.setHighlightActiveLine(false)
            this.editor.getSession().setTabSize(2)
            this.editor.setShowPrintMargin(false)

            if (this.mode === 'javascript') {
                this.editor.session.$worker.send('setOptions', [
                    {
                        esversion: 7,
                        globals: {
                            exec: true,
                            fetch: true,
                            require: true,
                            setTimeout: true,
                            setInterval: true,
                            clearTimeout: true,
                            clearInterval: true,
                        },
                        strict: 'implied',
                        undef: true,
                        asi: true,
                    },
                ])
            }

            this.editor.getSession().on('change', () => {
                this.$emit('edit', this.editor.getSession().getValue())
            })
        },
        methods: {
            setValue(value) {
                Vue.nextTick(() => this.editor.setValue(value, -1))
            },
        },
        watch: {
            mode() {
                this.editor.getSession().setMode(`ace/mode/${this.mode}`)
            },
            theme() {
                this.editor.setTheme(`ace/theme/${this.theme}`)
            },
        },
    }
</script>
