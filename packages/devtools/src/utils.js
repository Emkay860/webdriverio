import logger from '@wdio/logger'
import { commandCallStructure, isValidParameter, getArgumentType } from '@wdio/utils'
import { WebDriverProtocol } from '@wdio/protocols'

import cleanUp from './scripts/cleanUpSerializationSelector'
import { ELEMENT_KEY, SERIALIZE_PROPERTY, SERIALIZE_FLAG, ERROR_MESSAGES } from './constants'

const log = logger('devtools')

export const validate = function (command, parameters, variables, ref, args) {
    const commandParams = [...variables.map((v) => Object.assign(v, {
        /**
         * url variables are:
         */
        required: true, // always required as they are part of the endpoint
        type: 'string'  // have to be always type of string
    })), ...parameters]

    const commandUsage = `${command}(${commandParams.map((p) => p.name).join(', ')})`
    const moreInfo = `\n\nFor more info see ${ref}\n`
    const body = {}

    /**
     * parameter check
     */
    const minAllowedParams = commandParams.filter((param) => param.required).length
    if (args.length < minAllowedParams || args.length > commandParams.length) {
        const parameterDescription = commandParams.length
            ? `\n\nProperty Description:\n${commandParams.map((p) => `  "${p.name}" (${p.type}): ${p.description}`).join('\n')}`
            : ''

        throw new Error(
            `Wrong parameters applied for ${command}\n` +
            `Usage: ${commandUsage}` +
            parameterDescription +
            moreInfo
        )
    }

    /**
     * parameter type check
     */
    for (const [i, arg] of Object.entries(args)) {
        const commandParam = commandParams[i]

        if (!isValidParameter(arg, commandParam.type)) {
            /**
             * ignore if argument is not required
             */
            if (typeof arg === 'undefined' && !commandParam.required) {
                continue
            }

            throw new Error(
                `Malformed type for "${commandParam.name}" parameter of command ${command}\n` +
                `Expected: ${commandParam.type}\n` +
                `Actual: ${getArgumentType(arg)}` +
                moreInfo
            )
        }

        /**
         * rest of args are part of body payload
         */
        body[commandParams[i].name] = arg
    }

    log.info('COMMAND', commandCallStructure(command, args))
    return body
}

export function getPrototype (commandWrapper) {
    const prototype = {}

    for (const [endpoint, methods] of Object.entries(WebDriverProtocol)) {
        for (const [method, commandData] of Object.entries(methods)) {
            prototype[commandData.command] = { value: commandWrapper(method, endpoint, commandData) }
        }
    }

    return prototype
}

export async function findElement (page, value) {
    /**
     * implicitly wait for the element if timeout is set
     */
    const implicitTimeout = this.timeouts.get('implicit')
    if (implicitTimeout) {
        await page.waitForSelector(value, { timeout: implicitTimeout })
    }

    const element = await page.$(value)

    if (!element) {
        return new Error(`Element with selector "${value}" not found`)
    }

    const elementId = this.elementStore.set(element)
    return { [ELEMENT_KEY]: elementId }
}

export async function findElements (page, value) {
    /**
     * implicitly wait for the element if timeout is set
     */
    const implicitTimeout = this.timeouts.get('implicit')
    if (implicitTimeout) {
        await page.waitForSelector(value, { timeout: implicitTimeout })
    }

    const elements = await page.$$(value)

    if (elements.length === 0) {
        return elements
    }

    return elements.map((element) => ({
        [ELEMENT_KEY]: this.elementStore.set(element)
    }))
}

/**
 * convert DevTools errors into WebDriver errors so tools upstream
 * can handle it in similar fashion (e.g. stale element)
 */
export function sanitizeError (err) {
    let errorMessage = err.message

    if (err.message.includes('Node is detached from document')) {
        err.name = ERROR_MESSAGES.staleElement.name
        errorMessage = ERROR_MESSAGES.staleElement.message
    }

    const stack = err.stack.split('\n')
    const asyncStack = stack.lastIndexOf('  -- ASYNC --')
    err.stack = errorMessage + '\n' + stack.slice(asyncStack + 1)
        .filter((line) => !line.includes('devtools/node_modules/puppeteer-core'))
        .join('\n')
    return err
}

/**
 * transform elements in argument list to Puppeteer element handles
 */
export function transformExecuteArgs (args) {
    return args.map((arg) => {
        if (arg[ELEMENT_KEY]) {
            const elementHandle = this.elementStore.get(arg[ELEMENT_KEY])
            arg = elementHandle
        }

        return arg
    })
}

/**
 * fetch marked elements from execute script
 */
export async function transformExecuteResult (page, result) {
    const isResultArray = Array.isArray(result)
    let tmpResult = isResultArray ? result : [result]

    if (tmpResult.find((r) => typeof r === 'string' && r.startsWith(SERIALIZE_FLAG))) {
        tmpResult = await Promise.all(tmpResult.map(async (r) => {
            if (typeof r === 'string' && r.startsWith(SERIALIZE_FLAG)) {
                return findElement.call(this, page, `[${SERIALIZE_PROPERTY}="${r}"]`)
            }

            return result
        }))

        await page.$$eval(`[${SERIALIZE_PROPERTY}]`, cleanUp, SERIALIZE_PROPERTY)
    }

    return isResultArray ? tmpResult : tmpResult[0]
}