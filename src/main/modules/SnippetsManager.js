const chars = require('./chars')

const nodeLua = require('node-lua')

const NativeKeymap = require('native-keymap')

const _ = require('lodash')
const Notification = require('./Notification')
const fixPath = require('fix-path')

const KEY_BACKSPACE = 'Backspace'
const KEY_ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
const KEY_TAB = 'Tab'

class SnippetsManager {
    constructor({ store, keyboardHandler, keyboardSimulator, clipboard }) {
        this.store = store
        this.keyboardHandler = keyboardHandler
        this.keyboardSimulator = keyboardSimulator
        this.clipboard = clipboard

        this.buffer = ''
        this.shouldMatch = true
        this.timeout = 5000 // 5 seconds

        this.keyboardSimulator.setKeyboardDelay(0)

        this.keyboardHandler.on('keydown', e => this._onKeyDown(e))
        this.keyboardHandler.on('mouseclick', e => this._onMouseClick(e))

        this.keyboardHandler.start()

        fixPath()
    }

    destructor() {
        this.keyboardHandler.unload()
        this.keyboardHandler.stop()
    }

    _isBackspace(keycode) {
        return this._getCharNameFromKeycode(keycode) === KEY_BACKSPACE
    }

    _getCharNameFromKeycode(keycode) {
        return _.get(chars, keycode, null)
    }

    _eventToUnicode({ keycode, shiftKey, altKey, ctrlKey, metaKey }) {
        const name = this._getCharNameFromKeycode(keycode)
        const keymap = NativeKeymap.getKeyMap()

        if (!name || !(name in keymap)) {
            return false
        }

        let value

        if (shiftKey && altKey && !ctrlKey && !metaKey) {
            value = _.get(keymap, `${name}.withShiftAltGr`, false)
        } else if (shiftKey && !ctrlKey && !metaKey) {
            value = _.get(keymap, `${name}.withShift`, false)
        } else if (altKey && !ctrlKey && !metaKey) {
            value = _.get(keymap, `${name}.withAltGr`, false)
        } else if (!ctrlKey && !metaKey) {
            value = _.get(keymap, `${name}.value`, false)
        } else {
            value = false
        }

        if (!value) {
            return false
        }

        return value
    }

    _resetBuffer() {
        this.buffer = ''
    }

    _onMouseClick() {
        this._resetBuffer()
    }

    _shouldResetBuffer({ keycode, altKey }) {
        const pressed = this._getCharNameFromKeycode(keycode)

        return (pressed === KEY_BACKSPACE && altKey === true)
            || (pressed === KEY_TAB)
            || (KEY_ARROWS.includes(pressed))
    }

    _onKeyDown(e) {
        if (!this.shouldMatch) {
            return
        }

        if (this._shouldResetBuffer(e)) {
            this._resetBuffer()
            return
        }

        if (this._isBackspace(e.keycode)) {
            this._shortenBufferBy(1)
            return
        }

        const character = this._eventToUnicode(e)

        if (character) {
            this._addCharToBuffer(character)
            this._shortenBufferIfNecessary()
            this._replaceSnippetIfMatchFound()
        }

        console.log(this.buffer)
    }

    _evaluateLua(matchedString, code) {
        return new Promise((resolve, reject) => {
            'use strict'

            const timeout = setTimeout(() => reject('Function timed out after 5 seconds of inactivity'), this.timeout)

            let e = ''
            const lua = new nodeLua.LuaState()

            lua.RegisterFunction('qprint', () => {
                const a = lua.ToValue(1)

                lua.Pop(1)
                e += a

                return 0
            })

            try {
                lua.DoString(code)
            } catch (err) {
                reject(String(err))
            }

            const r = (data) => {
                clearTimeout(timeout)

                resolve(data)
            }

            try {
                lua.GetGlobal('qw')
                lua.Push(matchedString)
                lua.Call(1, 0)
                lua.Pop(1)
            } catch (err) {
                reject(err)
            }

            r(e)
        })
    }

    _evaluateJavascript(matchedString, code) {
        return new Promise((resolve, reject) => {
            'use strict'

            const timeout = setTimeout(() => reject('Function timed out after 5 seconds of inactivity'), this.timeout)

            let executable

            try {
                executable = eval(`
                    const fetch = require('node-fetch');
                    const exec = require('child_process').exec;
                    (${code})
                `)
            } catch (err) {
                reject(String(err))
            }

            if (!_.isFunction(executable)) {
                reject('Used snippet code is not a function')
            }

            const r = (data) => {
                clearTimeout(timeout)

                resolve(data)
            }

            let e

            try {
                e = executable(matchedString)
            } catch (err) {
                reject(err)
            }

            if (_.isObject(e) && _.isFunction(e.then)) {
                e.then(r).catch(reject)
            } else if (_.isString(e) || _.isNumber(e)) {
                r(e)
            } else {
                reject('User-defined function returned invalid type. Expected a Promise, string or number.')
            }
        })
    }

    async _replaceSnippetIfMatchFound() {
        for (const snippet of this.store.get('snippets')) {
            let key = snippet.key

            if (!snippet.regex) {
                // escape all regex-special characters
                key = _.escapeRegExp(key)
            }

            const match = new RegExp(`.*(${key})$`).exec(this.buffer)
            const matchedString = _.get(match, 1, false)

            if (matchedString) {
                for (let i = 0; i < matchedString.length; i++) {
                    this.keyboardSimulator.keyTap('backspace')
                }

                if (snippet.type === 'js') {
                    this.replace(await this._handleJavascriptSnippet(matchedString, snippet.value))
                } else if (snippet.type === 'lua') {
                    this.replace(await this._handleLuaSnippet(matchedString, snippet.value))
                } else {
                    this.replace(this._handlePlainTextSnippet(snippet.value))
                }

                break
            }
        }
    }

    replace(value) {
        const clipboardContent = this.clipboard.readText()


        this.clipboard.writeText(value)

        setTimeout(() => this.keyboardSimulator.keyTap('v', 'command'), 50)
        setTimeout(() => this.clipboard.writeText(clipboardContent), 500)
    }

    async _handleLuaSnippet(matchedString, code) {
        const clipboardContent = this.clipboard.readText()

        try {
            const data = await this._evaluateLua(matchedString, code)

            this.clipboard.writeText(data)
        } catch (error) {
            this.clipboard.writeText(`QWError: ${_.get('error', 'message', String(error))}`)
        } finally {
            setTimeout(() => this.keyboardSimulator.keyTap('v', 'command'), 50)
            setTimeout(() => this.clipboard.writeText(clipboardContent), 500)
        }
    }

    async _handleJavascriptSnippet(matchedString, code) {
        try {
            return await this._evaluate(matchedString, code)
        } catch (error) {
            if (!Notification.isSupported()) {
                return `QWError ${_.get('error', 'message', String(error))}`
            }

            Notification.show('QWError', _.get('error', 'message', String(error)))

            return ''
        }
    }

    _handlePlainTextSnippet(value) {
        return value
    }

    _addCharToBuffer(character) {
        this.buffer += character
    }

    _shortenBufferBy(amount) {
        this.buffer = this.buffer.substring(0, this.buffer.length - amount)
    }

    _shortenBufferIfNecessary() {
        if (this.buffer.length > this.store.get('bufferLength')) {
            this.buffer = this.buffer.substring(1)
        }
    }
}

module.exports = SnippetsManager
