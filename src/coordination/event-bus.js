"use strict";
// src/coordination/event-bus.js — 零依赖事件总线
//
// API:
//   on(event: string, handler: Function) → void
//   off(event: string, handler?: Function) → void
//   emit(event: string, ...args: any[]) → void
//
// 设计原则:
// - 无外部依赖（不调用 require），确保不引入新循环
// - 支持多订阅者队列
// - 静默失败：无订阅者时 emit 不抛错
// - 同步调用：emit 阻塞直到所有 handler 返回

const subscribers = Object.create(null); // { eventName: [handler1, handler2] }

const on = (event, handler) => {
    if (!subscribers[event]) {
        subscribers[event] = [];
    }
    if (!subscribers[event].includes(handler)) {
        subscribers[event].push(handler);
    }
};

const off = (event, handler) => {
    if (!event) {
        // 清除所有订阅
        Object.keys(subscribers).forEach(key => {
            delete subscribers[key];
        });
        return;
    }
    const handlers = subscribers[event];
    if (!handlers) return;
    if (!handler) {
        delete subscribers[event];
    } else {
        const idx = handlers.indexOf(handler);
        if (idx > -1) {
            handlers.splice(idx, 1);
            if (handlers.length === 0) {
                delete subscribers[event];
            }
        }
    }
};

const emit = (event, ...args) => {
    const handlers = subscribers[event];
    if (!handlers || handlers.length === 0) {
        return; // 无订阅者静默失败
    }
    // 复制数组避免迭代期间修改引发问题
    handlers.slice().forEach(handler => {
        try {
            handler(...args);
        } catch (error) {
            console.error(`[EventBus] Handler error for "${event}":`, error);
        }
    });
};

module.exports = { on, off, emit };
