/* jshint devel: true */
/* jshint globalstrict: true */

'use strict';

function Scope() {
    this.watchers = [];
    this.lastDirtyWatch = null;
    this.asyncQueue = [];
    this.postDigestQueue = [];
    this.phase = null;
    this.phases = {
        getDigestPhase: "digest",
        getApplyPhase: "apply"
    };
}

/**
 * Initialize the prev attribute to something we can guarantee to be unique.
 *
 * This way new watches will always have their listener functions invoked, whatever their
 * watch functions might return.
 */
function initWatchValue() {
}

/**
 * With this function you can attach watcher to scope.
 * A watcher is something that is notified when a change occurs in the scope.
 *
 * @param watchFn A watch function, which specifies the piece of data you’re interested in.
 * @param listenerFn A listener function which will be called whenever that data changes.
 * @param valueEq When the flag is true, value-based checking is used.
 */
Scope.prototype.watch = function (watchFn, listenerFn, valueEq) {
    var watcher,
        that = this;

    watcher = {
        watchFn: watchFn,
        listenerFn: listenerFn || function () {
        },
        valueEq: !!valueEq,
        prev: initWatchValue
    };
    this.watchers.push(watcher);
    this.lastDirtyWatch = null;

    return function () {
        _.remove(that.watchers, function (w) {
            return _.isEqual(w, watcher);
        });
    };
};

/**
 * It takes several watch functions wrapped in an array, and a single
 * listener function. The idea is that when any of the watch functions given in the array
 * detects a change, the listener function is invoked.
 * @param watchFns several watch functions wrapped in an array.
 * @param listenerFn listener function.
 */
Scope.prototype.watchGroup = function (watchFns, listenerFn) {
    var that = this,
        prevValues = watchFns,
        currValues = watchFns;

    _.forEach(watchFns, function (wFn) {
        that.watch(wFn, function (currValue, prevValue) {
            currValues.push(currValue);
            prevValue.push(prevValue);
            listenerFn(prevValues, currValue, that);
        });
    });
};

/**
 * It runs all the watchers once, and returns a boolean value that determines whether there
 * were any changes or not.
 * @returns {boolean}
 */
Scope.prototype.digestOnce = function () {
    var that = this,
        prevValue,
        currValue,
        dirty = false;
    _.forEach(this.watchers, function (watcher) {
        try {
            currValue = watcher.watchFn(that);
            prevValue = watcher.prev;
            if (!that.areEqual(currValue, prevValue, watcher.valueEq)) {
                that.lastDirtyWatch = watcher;
                watcher.prev = (watcher.valueEq ? _.cloneDeep(currValue) : currValue);
                watcher.listenerFn(currValue,
                    (prevValue === initWatchValue ? currValue : prevValue),
                    that);
                dirty = true;
            } else if (that.lastDirtyWatch === watcher) {
                return false;
            }
        } catch (e) {
            console.error(e);
        }
    });
    return dirty;
};

/**
 * It runs the "outer loop", calling digestOnce as long as changes keep occurring.
 */
Scope.prototype.digest = function () {
    var ttl = 10,
        asyncExpr;
    this.lastDirtyWatch = null;
    this.startPhase(this.phases.getDigestPhase);
    while (this.digestOnce() || this.asyncQueue.length) {
        while (this.asyncQueue.length) {
            try {
                asyncExpr = this.asyncQueue.shift();
                asyncExpr.scope.eval(asyncExpr.expr);
            } catch (e) {
                console.error(e);
            }
        }
        if ((this.digestOnce() || this.asyncQueue.length) && ttl < 0) {
            this.clearPhase();
            throw "A lot of digest operations!";
        }
        ttl--;
    }
    this.clearPhase();

    while (this.postDigestQueue.length) {
        try {
            this.postDigestQueue.shift()();
        } catch (e) {
            console.error(e);
        }
    }
};

/**
 * It takes two values and the boolean flag, and compares the values accordingly.
 * @param currValue first value to compare.
 * @param prevValue second value to compare.
 * @param valueEq flag which determines how values will be compared.
 * @returns {boolean}
 */
Scope.prototype.areEqual = function (currValue, prevValue, valueEq) {
    if (valueEq) {
        return _.isEqual(currValue, prevValue);
    } else {
        return (currValue === prevValue);
    }
};

/**
 * Evaluate expression.
 * @param expr expression to evaluate
 * @returns {*}
 */
Scope.prototype.eval = function (expr) {
    return expr(this);
};

/**
 * It takes a function as an argument. It executes that function using eval, and then
 * run the digest cycle by invoking digest.
 * @param expr function to evaluate.
 * @returns {*}
 */
Scope.prototype.apply = function (expr) {
    try {
        this.startPhase(this.phases.getApplyPhase);
        return this.eval(expr);
    } finally {
        this.clearPhase();
        this.digest();
    }
};

/**
 * It adds the function to execute on asyncQueue queue.
 * @param expr function to evaluate later.
 */
Scope.prototype.evalAsync = function (expr) {
    var that = this;
    if (!that.phase && !that.asyncQueue.length) {
        setTimeout(function () {
            if (that.asyncQueue.length) {
                that.digest();
            }
        }, 0);
    }
    this.asyncQueue.push({
        scope: this,
        expr: expr
    });
};

/**
 * Start new phase.
 * @param phase new phase.
 */
Scope.prototype.startPhase = function (phase) {
    if (this.phase !== null) {
        throw this.phase + " already started!";
    }
    this.phase = phase;
};

/**
 * Clear current phase.
 */
Scope.prototype.clearPhase = function () {
    this.phase = null;
};

/**
 * It is add the given function to the postDigestQueue queue.
 * @param fn function to add.
 */
Scope.prototype.postDigest = function (fn) {
    this.postDigestQueue.push(fn);
};