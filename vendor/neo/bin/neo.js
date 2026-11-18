#!/usr/bin/env node
import{createRequire as __createRequire}from'node:module';const require=__createRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a2, b) => (typeof require !== "undefined" ? require : a2)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/yaml/dist/nodes/identity.js
var require_identity = __commonJS({
  "node_modules/yaml/dist/nodes/identity.js"(exports) {
    "use strict";
    var ALIAS = Symbol.for("yaml.alias");
    var DOC = Symbol.for("yaml.document");
    var MAP = Symbol.for("yaml.map");
    var PAIR = Symbol.for("yaml.pair");
    var SCALAR = Symbol.for("yaml.scalar");
    var SEQ = Symbol.for("yaml.seq");
    var NODE_TYPE = Symbol.for("yaml.node.type");
    var isAlias = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS;
    var isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
    var isMap = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
    var isPair = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === PAIR;
    var isScalar = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SCALAR;
    var isSeq = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SEQ;
    function isCollection(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case MAP:
          case SEQ:
            return true;
        }
      return false;
    }
    function isNode(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case ALIAS:
          case MAP:
          case SCALAR:
          case SEQ:
            return true;
        }
      return false;
    }
    var hasAnchor = (node) => (isScalar(node) || isCollection(node)) && !!node.anchor;
    exports.ALIAS = ALIAS;
    exports.DOC = DOC;
    exports.MAP = MAP;
    exports.NODE_TYPE = NODE_TYPE;
    exports.PAIR = PAIR;
    exports.SCALAR = SCALAR;
    exports.SEQ = SEQ;
    exports.hasAnchor = hasAnchor;
    exports.isAlias = isAlias;
    exports.isCollection = isCollection;
    exports.isDocument = isDocument;
    exports.isMap = isMap;
    exports.isNode = isNode;
    exports.isPair = isPair;
    exports.isScalar = isScalar;
    exports.isSeq = isSeq;
  }
});

// node_modules/yaml/dist/visit.js
var require_visit = __commonJS({
  "node_modules/yaml/dist/visit.js"(exports) {
    "use strict";
    var identity = require_identity();
    var BREAK = Symbol("break visit");
    var SKIP = Symbol("skip children");
    var REMOVE = Symbol("remove node");
    function visit(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = visit_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        visit_(null, node, visitor_, Object.freeze([]));
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    function visit_(key, node, visitor, path27) {
      const ctrl = callVisitor(key, node, visitor, path27);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path27, ctrl);
        return visit_(key, ctrl, visitor, path27);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path27 = Object.freeze(path27.concat(node));
          for (let i2 = 0; i2 < node.items.length; ++i2) {
            const ci = visit_(i2, node.items[i2], visitor, path27);
            if (typeof ci === "number")
              i2 = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i2, 1);
              i2 -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path27 = Object.freeze(path27.concat(node));
          const ck = visit_("key", node.key, visitor, path27);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = visit_("value", node.value, visitor, path27);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    async function visitAsync(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = await visitAsync_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        await visitAsync_(null, node, visitor_, Object.freeze([]));
    }
    visitAsync.BREAK = BREAK;
    visitAsync.SKIP = SKIP;
    visitAsync.REMOVE = REMOVE;
    async function visitAsync_(key, node, visitor, path27) {
      const ctrl = await callVisitor(key, node, visitor, path27);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path27, ctrl);
        return visitAsync_(key, ctrl, visitor, path27);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path27 = Object.freeze(path27.concat(node));
          for (let i2 = 0; i2 < node.items.length; ++i2) {
            const ci = await visitAsync_(i2, node.items[i2], visitor, path27);
            if (typeof ci === "number")
              i2 = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i2, 1);
              i2 -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path27 = Object.freeze(path27.concat(node));
          const ck = await visitAsync_("key", node.key, visitor, path27);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = await visitAsync_("value", node.value, visitor, path27);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    function initVisitor(visitor) {
      if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) {
        return Object.assign({
          Alias: visitor.Node,
          Map: visitor.Node,
          Scalar: visitor.Node,
          Seq: visitor.Node
        }, visitor.Value && {
          Map: visitor.Value,
          Scalar: visitor.Value,
          Seq: visitor.Value
        }, visitor.Collection && {
          Map: visitor.Collection,
          Seq: visitor.Collection
        }, visitor);
      }
      return visitor;
    }
    function callVisitor(key, node, visitor, path27) {
      if (typeof visitor === "function")
        return visitor(key, node, path27);
      if (identity.isMap(node))
        return visitor.Map?.(key, node, path27);
      if (identity.isSeq(node))
        return visitor.Seq?.(key, node, path27);
      if (identity.isPair(node))
        return visitor.Pair?.(key, node, path27);
      if (identity.isScalar(node))
        return visitor.Scalar?.(key, node, path27);
      if (identity.isAlias(node))
        return visitor.Alias?.(key, node, path27);
      return void 0;
    }
    function replaceNode(key, path27, node) {
      const parent = path27[path27.length - 1];
      if (identity.isCollection(parent)) {
        parent.items[key] = node;
      } else if (identity.isPair(parent)) {
        if (key === "key")
          parent.key = node;
        else
          parent.value = node;
      } else if (identity.isDocument(parent)) {
        parent.contents = node;
      } else {
        const pt = identity.isAlias(parent) ? "alias" : "scalar";
        throw new Error(`Cannot replace node with ${pt} parent`);
      }
    }
    exports.visit = visit;
    exports.visitAsync = visitAsync;
  }
});

// node_modules/yaml/dist/doc/directives.js
var require_directives = __commonJS({
  "node_modules/yaml/dist/doc/directives.js"(exports) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    var escapeChars = {
      "!": "%21",
      ",": "%2C",
      "[": "%5B",
      "]": "%5D",
      "{": "%7B",
      "}": "%7D"
    };
    var escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
    var Directives = class _Directives {
      constructor(yaml, tags) {
        this.docStart = null;
        this.docEnd = false;
        this.yaml = Object.assign({}, _Directives.defaultYaml, yaml);
        this.tags = Object.assign({}, _Directives.defaultTags, tags);
      }
      clone() {
        const copy = new _Directives(this.yaml, this.tags);
        copy.docStart = this.docStart;
        return copy;
      }
      /**
       * During parsing, get a Directives instance for the current document and
       * update the stream state according to the current version's spec.
       */
      atDocument() {
        const res = new _Directives(this.yaml, this.tags);
        switch (this.yaml.version) {
          case "1.1":
            this.atNextDocument = true;
            break;
          case "1.2":
            this.atNextDocument = false;
            this.yaml = {
              explicit: _Directives.defaultYaml.explicit,
              version: "1.2"
            };
            this.tags = Object.assign({}, _Directives.defaultTags);
            break;
        }
        return res;
      }
      /**
       * @param onError - May be called even if the action was successful
       * @returns `true` on success
       */
      add(line, onError) {
        if (this.atNextDocument) {
          this.yaml = { explicit: _Directives.defaultYaml.explicit, version: "1.1" };
          this.tags = Object.assign({}, _Directives.defaultTags);
          this.atNextDocument = false;
        }
        const parts = line.trim().split(/[ \t]+/);
        const name = parts.shift();
        switch (name) {
          case "%TAG": {
            if (parts.length !== 2) {
              onError(0, "%TAG directive should contain exactly two parts");
              if (parts.length < 2)
                return false;
            }
            const [handle, prefix] = parts;
            this.tags[handle] = prefix;
            return true;
          }
          case "%YAML": {
            this.yaml.explicit = true;
            if (parts.length !== 1) {
              onError(0, "%YAML directive should contain exactly one part");
              return false;
            }
            const [version] = parts;
            if (version === "1.1" || version === "1.2") {
              this.yaml.version = version;
              return true;
            } else {
              const isValid = /^\d+\.\d+$/.test(version);
              onError(6, `Unsupported YAML version ${version}`, isValid);
              return false;
            }
          }
          default:
            onError(0, `Unknown directive ${name}`, true);
            return false;
        }
      }
      /**
       * Resolves a tag, matching handles to those defined in %TAG directives.
       *
       * @returns Resolved tag, which may also be the non-specific tag `'!'` or a
       *   `'!local'` tag, or `null` if unresolvable.
       */
      tagName(source, onError) {
        if (source === "!")
          return "!";
        if (source[0] !== "!") {
          onError(`Not a valid tag: ${source}`);
          return null;
        }
        if (source[1] === "<") {
          const verbatim = source.slice(2, -1);
          if (verbatim === "!" || verbatim === "!!") {
            onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
            return null;
          }
          if (source[source.length - 1] !== ">")
            onError("Verbatim tags must end with a >");
          return verbatim;
        }
        const [, handle, suffix] = source.match(/^(.*!)([^!]*)$/s);
        if (!suffix)
          onError(`The ${source} tag has no suffix`);
        const prefix = this.tags[handle];
        if (prefix) {
          try {
            return prefix + decodeURIComponent(suffix);
          } catch (error) {
            onError(String(error));
            return null;
          }
        }
        if (handle === "!")
          return source;
        onError(`Could not resolve tag: ${source}`);
        return null;
      }
      /**
       * Given a fully resolved tag, returns its printable string form,
       * taking into account current tag prefixes and defaults.
       */
      tagString(tag) {
        for (const [handle, prefix] of Object.entries(this.tags)) {
          if (tag.startsWith(prefix))
            return handle + escapeTagName(tag.substring(prefix.length));
        }
        return tag[0] === "!" ? tag : `!<${tag}>`;
      }
      toString(doc) {
        const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
        const tagEntries = Object.entries(this.tags);
        let tagNames;
        if (doc && tagEntries.length > 0 && identity.isNode(doc.contents)) {
          const tags = {};
          visit.visit(doc.contents, (_key, node) => {
            if (identity.isNode(node) && node.tag)
              tags[node.tag] = true;
          });
          tagNames = Object.keys(tags);
        } else
          tagNames = [];
        for (const [handle, prefix] of tagEntries) {
          if (handle === "!!" && prefix === "tag:yaml.org,2002:")
            continue;
          if (!doc || tagNames.some((tn) => tn.startsWith(prefix)))
            lines.push(`%TAG ${handle} ${prefix}`);
        }
        return lines.join("\n");
      }
    };
    Directives.defaultYaml = { explicit: false, version: "1.2" };
    Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };
    exports.Directives = Directives;
  }
});

// node_modules/yaml/dist/doc/anchors.js
var require_anchors = __commonJS({
  "node_modules/yaml/dist/doc/anchors.js"(exports) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    function anchorIsValid(anchor) {
      if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
        const sa = JSON.stringify(anchor);
        const msg = `Anchor must not contain whitespace or control characters: ${sa}`;
        throw new Error(msg);
      }
      return true;
    }
    function anchorNames(root) {
      const anchors = /* @__PURE__ */ new Set();
      visit.visit(root, {
        Value(_key, node) {
          if (node.anchor)
            anchors.add(node.anchor);
        }
      });
      return anchors;
    }
    function findNewAnchor(prefix, exclude) {
      for (let i2 = 1; true; ++i2) {
        const name = `${prefix}${i2}`;
        if (!exclude.has(name))
          return name;
      }
    }
    function createNodeAnchors(doc, prefix) {
      const aliasObjects = [];
      const sourceObjects = /* @__PURE__ */ new Map();
      let prevAnchors = null;
      return {
        onAnchor: (source) => {
          aliasObjects.push(source);
          prevAnchors ?? (prevAnchors = anchorNames(doc));
          const anchor = findNewAnchor(prefix, prevAnchors);
          prevAnchors.add(anchor);
          return anchor;
        },
        /**
         * With circular references, the source node is only resolved after all
         * of its child nodes are. This is why anchors are set only after all of
         * the nodes have been created.
         */
        setAnchors: () => {
          for (const source of aliasObjects) {
            const ref = sourceObjects.get(source);
            if (typeof ref === "object" && ref.anchor && (identity.isScalar(ref.node) || identity.isCollection(ref.node))) {
              ref.node.anchor = ref.anchor;
            } else {
              const error = new Error("Failed to resolve repeated object (this should not happen)");
              error.source = source;
              throw error;
            }
          }
        },
        sourceObjects
      };
    }
    exports.anchorIsValid = anchorIsValid;
    exports.anchorNames = anchorNames;
    exports.createNodeAnchors = createNodeAnchors;
    exports.findNewAnchor = findNewAnchor;
  }
});

// node_modules/yaml/dist/doc/applyReviver.js
var require_applyReviver = __commonJS({
  "node_modules/yaml/dist/doc/applyReviver.js"(exports) {
    "use strict";
    function applyReviver(reviver, obj, key, val) {
      if (val && typeof val === "object") {
        if (Array.isArray(val)) {
          for (let i2 = 0, len = val.length; i2 < len; ++i2) {
            const v0 = val[i2];
            const v1 = applyReviver(reviver, val, String(i2), v0);
            if (v1 === void 0)
              delete val[i2];
            else if (v1 !== v0)
              val[i2] = v1;
          }
        } else if (val instanceof Map) {
          for (const k of Array.from(val.keys())) {
            const v0 = val.get(k);
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              val.delete(k);
            else if (v1 !== v0)
              val.set(k, v1);
          }
        } else if (val instanceof Set) {
          for (const v0 of Array.from(val)) {
            const v1 = applyReviver(reviver, val, v0, v0);
            if (v1 === void 0)
              val.delete(v0);
            else if (v1 !== v0) {
              val.delete(v0);
              val.add(v1);
            }
          }
        } else {
          for (const [k, v0] of Object.entries(val)) {
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              delete val[k];
            else if (v1 !== v0)
              val[k] = v1;
          }
        }
      }
      return reviver.call(obj, key, val);
    }
    exports.applyReviver = applyReviver;
  }
});

// node_modules/yaml/dist/nodes/toJS.js
var require_toJS = __commonJS({
  "node_modules/yaml/dist/nodes/toJS.js"(exports) {
    "use strict";
    var identity = require_identity();
    function toJS(value, arg, ctx) {
      if (Array.isArray(value))
        return value.map((v, i2) => toJS(v, String(i2), ctx));
      if (value && typeof value.toJSON === "function") {
        if (!ctx || !identity.hasAnchor(value))
          return value.toJSON(arg, ctx);
        const data = { aliasCount: 0, count: 1, res: void 0 };
        ctx.anchors.set(value, data);
        ctx.onCreate = (res2) => {
          data.res = res2;
          delete ctx.onCreate;
        };
        const res = value.toJSON(arg, ctx);
        if (ctx.onCreate)
          ctx.onCreate(res);
        return res;
      }
      if (typeof value === "bigint" && !ctx?.keep)
        return Number(value);
      return value;
    }
    exports.toJS = toJS;
  }
});

// node_modules/yaml/dist/nodes/Node.js
var require_Node = __commonJS({
  "node_modules/yaml/dist/nodes/Node.js"(exports) {
    "use strict";
    var applyReviver = require_applyReviver();
    var identity = require_identity();
    var toJS = require_toJS();
    var NodeBase = class {
      constructor(type) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: type });
      }
      /** Create a copy of this node.  */
      clone() {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** A plain JavaScript representation of this node. */
      toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        if (!identity.isDocument(doc))
          throw new TypeError("A document argument is required");
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc,
          keep: true,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this, "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
    };
    exports.NodeBase = NodeBase;
  }
});

// node_modules/yaml/dist/nodes/Alias.js
var require_Alias = __commonJS({
  "node_modules/yaml/dist/nodes/Alias.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var visit = require_visit();
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var Alias = class extends Node.NodeBase {
      constructor(source) {
        super(identity.ALIAS);
        this.source = source;
        Object.defineProperty(this, "tag", {
          set() {
            throw new Error("Alias nodes cannot have tags");
          }
        });
      }
      /**
       * Resolve the value of this alias within `doc`, finding the last
       * instance of the `source` anchor before this node.
       */
      resolve(doc, ctx) {
        if (ctx?.maxAliasCount === 0)
          throw new ReferenceError("Alias resolution is disabled");
        let nodes;
        if (ctx?.aliasResolveCache) {
          nodes = ctx.aliasResolveCache;
        } else {
          nodes = [];
          visit.visit(doc, {
            Node: (_key, node) => {
              if (identity.isAlias(node) || identity.hasAnchor(node))
                nodes.push(node);
            }
          });
          if (ctx)
            ctx.aliasResolveCache = nodes;
        }
        let found = void 0;
        for (const node of nodes) {
          if (node === this)
            break;
          if (node.anchor === this.source)
            found = node;
        }
        if (found && ctx) {
          const { anchors: anchors2, doc: doc2, maxAliasCount } = ctx;
          let data = anchors2.get(found);
          if (!data) {
            toJS.toJS(found, null, ctx);
            data = anchors2.get(found);
          }
          if (data?.res === void 0) {
            const msg = "This should not happen: Alias anchor was not resolved?";
            throw new ReferenceError(msg);
          }
          if (maxAliasCount >= 0) {
            data.count += 1;
            if (data.aliasCount === 0)
              data.aliasCount = getAliasCount(doc2, found, anchors2);
            if (data.count * data.aliasCount > maxAliasCount) {
              const msg = "Excessive alias count indicates a resource exhaustion attack";
              throw new ReferenceError(msg);
            }
          }
        }
        return found;
      }
      toJSON(_arg, ctx) {
        if (!ctx)
          return { source: this.source };
        const source = this.resolve(ctx.doc, ctx);
        if (!source) {
          const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
          throw new ReferenceError(msg);
        }
        return ctx.anchors.get(source).res;
      }
      toString(ctx, _onComment, _onChompKeep) {
        const src = `*${this.source}`;
        if (ctx) {
          anchors.anchorIsValid(this.source);
          if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
            const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
            throw new Error(msg);
          }
          if (ctx.implicitKey)
            return `${src} `;
        }
        return src;
      }
    };
    function getAliasCount(doc, node, anchors2) {
      if (identity.isAlias(node)) {
        const source = node.resolve(doc);
        const anchor = anchors2 && source && anchors2.get(source);
        return anchor ? anchor.count * anchor.aliasCount : 0;
      } else if (identity.isCollection(node)) {
        let count = 0;
        for (const item of node.items) {
          const c3 = getAliasCount(doc, item, anchors2);
          if (c3 > count)
            count = c3;
        }
        return count;
      } else if (identity.isPair(node)) {
        const kc = getAliasCount(doc, node.key, anchors2);
        const vc = getAliasCount(doc, node.value, anchors2);
        return Math.max(kc, vc);
      }
      return 1;
    }
    exports.Alias = Alias;
  }
});

// node_modules/yaml/dist/nodes/Scalar.js
var require_Scalar = __commonJS({
  "node_modules/yaml/dist/nodes/Scalar.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
    var Scalar = class extends Node.NodeBase {
      constructor(value) {
        super(identity.SCALAR);
        this.value = value;
      }
      toJSON(arg, ctx) {
        return ctx?.keep ? this.value : toJS.toJS(this.value, arg, ctx);
      }
      toString() {
        return String(this.value);
      }
    };
    Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
    Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
    Scalar.PLAIN = "PLAIN";
    Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
    Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";
    exports.Scalar = Scalar;
    exports.isScalarValue = isScalarValue;
  }
});

// node_modules/yaml/dist/doc/createNode.js
var require_createNode = __commonJS({
  "node_modules/yaml/dist/doc/createNode.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var defaultTagPrefix = "tag:yaml.org,2002:";
    function findTagObject(value, tagName, tags) {
      if (tagName) {
        const match = tags.filter((t2) => t2.tag === tagName);
        const tagObj = match.find((t2) => !t2.format) ?? match[0];
        if (!tagObj)
          throw new Error(`Tag ${tagName} not found`);
        return tagObj;
      }
      return tags.find((t2) => t2.identify?.(value) && !t2.format);
    }
    function createNode(value, tagName, ctx) {
      if (identity.isDocument(value))
        value = value.contents;
      if (identity.isNode(value))
        return value;
      if (identity.isPair(value)) {
        const map = ctx.schema[identity.MAP].createNode?.(ctx.schema, null, ctx);
        map.items.push(value);
        return map;
      }
      if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) {
        value = value.valueOf();
      }
      const { aliasDuplicateObjects, onAnchor, onTagObj, schema, sourceObjects } = ctx;
      let ref = void 0;
      if (aliasDuplicateObjects && value && typeof value === "object") {
        ref = sourceObjects.get(value);
        if (ref) {
          ref.anchor ?? (ref.anchor = onAnchor(value));
          return new Alias.Alias(ref.anchor);
        } else {
          ref = { anchor: null, node: null };
          sourceObjects.set(value, ref);
        }
      }
      if (tagName?.startsWith("!!"))
        tagName = defaultTagPrefix + tagName.slice(2);
      let tagObj = findTagObject(value, tagName, schema.tags);
      if (!tagObj) {
        if (value && typeof value.toJSON === "function") {
          value = value.toJSON();
        }
        if (!value || typeof value !== "object") {
          const node2 = new Scalar.Scalar(value);
          if (ref)
            ref.node = node2;
          return node2;
        }
        tagObj = value instanceof Map ? schema[identity.MAP] : Symbol.iterator in Object(value) ? schema[identity.SEQ] : schema[identity.MAP];
      }
      if (onTagObj) {
        onTagObj(tagObj);
        delete ctx.onTagObj;
      }
      const node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar.Scalar(value);
      if (tagName)
        node.tag = tagName;
      else if (!tagObj.default)
        node.tag = tagObj.tag;
      if (ref)
        ref.node = node;
      return node;
    }
    exports.createNode = createNode;
  }
});

// node_modules/yaml/dist/nodes/Collection.js
var require_Collection = __commonJS({
  "node_modules/yaml/dist/nodes/Collection.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var identity = require_identity();
    var Node = require_Node();
    function collectionFromPath(schema, path27, value) {
      let v = value;
      for (let i2 = path27.length - 1; i2 >= 0; --i2) {
        const k = path27[i2];
        if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
          const a2 = [];
          a2[k] = v;
          v = a2;
        } else {
          v = /* @__PURE__ */ new Map([[k, v]]);
        }
      }
      return createNode.createNode(v, void 0, {
        aliasDuplicateObjects: false,
        keepUndefined: false,
        onAnchor: () => {
          throw new Error("This should not happen, please report a bug.");
        },
        schema,
        sourceObjects: /* @__PURE__ */ new Map()
      });
    }
    var isEmptyPath = (path27) => path27 == null || typeof path27 === "object" && !!path27[Symbol.iterator]().next().done;
    var Collection = class extends Node.NodeBase {
      constructor(type, schema) {
        super(type);
        Object.defineProperty(this, "schema", {
          value: schema,
          configurable: true,
          enumerable: false,
          writable: true
        });
      }
      /**
       * Create a copy of this collection.
       *
       * @param schema - If defined, overwrites the original's schema
       */
      clone(schema) {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (schema)
          copy.schema = schema;
        copy.items = copy.items.map((it) => identity.isNode(it) || identity.isPair(it) ? it.clone(schema) : it);
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /**
       * Adds a value to the collection. For `!!map` and `!!omap` the value must
       * be a Pair instance or a `{ key, value }` object, which may not have a key
       * that already exists in the map.
       */
      addIn(path27, value) {
        if (isEmptyPath(path27))
          this.add(value);
        else {
          const [key, ...rest] = path27;
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.addIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
      /**
       * Removes a value from the collection.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path27) {
        const [key, ...rest] = path27;
        if (rest.length === 0)
          return this.delete(key);
        const node = this.get(key, true);
        if (identity.isCollection(node))
          return node.deleteIn(rest);
        else
          throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path27, keepScalar) {
        const [key, ...rest] = path27;
        const node = this.get(key, true);
        if (rest.length === 0)
          return !keepScalar && identity.isScalar(node) ? node.value : node;
        else
          return identity.isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
      }
      hasAllNullValues(allowScalar) {
        return this.items.every((node) => {
          if (!identity.isPair(node))
            return false;
          const n3 = node.value;
          return n3 == null || allowScalar && identity.isScalar(n3) && n3.value == null && !n3.commentBefore && !n3.comment && !n3.tag;
        });
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       */
      hasIn(path27) {
        const [key, ...rest] = path27;
        if (rest.length === 0)
          return this.has(key);
        const node = this.get(key, true);
        return identity.isCollection(node) ? node.hasIn(rest) : false;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path27, value) {
        const [key, ...rest] = path27;
        if (rest.length === 0) {
          this.set(key, value);
        } else {
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.setIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
    };
    exports.Collection = Collection;
    exports.collectionFromPath = collectionFromPath;
    exports.isEmptyPath = isEmptyPath;
  }
});

// node_modules/yaml/dist/stringify/stringifyComment.js
var require_stringifyComment = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyComment.js"(exports) {
    "use strict";
    var stringifyComment = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
    function indentComment(comment, indent) {
      if (/^\n+$/.test(comment))
        return comment.substring(1);
      return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
    }
    var lineComment = (str, indent, comment) => str.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str.endsWith(" ") ? "" : " ") + comment;
    exports.indentComment = indentComment;
    exports.lineComment = lineComment;
    exports.stringifyComment = stringifyComment;
  }
});

// node_modules/yaml/dist/stringify/foldFlowLines.js
var require_foldFlowLines = __commonJS({
  "node_modules/yaml/dist/stringify/foldFlowLines.js"(exports) {
    "use strict";
    var FOLD_FLOW = "flow";
    var FOLD_BLOCK = "block";
    var FOLD_QUOTED = "quoted";
    function foldFlowLines(text2, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
      if (!lineWidth || lineWidth < 0)
        return text2;
      if (lineWidth < minContentWidth)
        minContentWidth = 0;
      const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
      if (text2.length <= endStep)
        return text2;
      const folds = [];
      const escapedFolds = {};
      let end = lineWidth - indent.length;
      if (typeof indentAtStart === "number") {
        if (indentAtStart > lineWidth - Math.max(2, minContentWidth))
          folds.push(0);
        else
          end = lineWidth - indentAtStart;
      }
      let split = void 0;
      let prev = void 0;
      let overflow = false;
      let i2 = -1;
      let escStart = -1;
      let escEnd = -1;
      if (mode === FOLD_BLOCK) {
        i2 = consumeMoreIndentedLines(text2, i2, indent.length);
        if (i2 !== -1)
          end = i2 + endStep;
      }
      for (let ch; ch = text2[i2 += 1]; ) {
        if (mode === FOLD_QUOTED && ch === "\\") {
          escStart = i2;
          switch (text2[i2 + 1]) {
            case "x":
              i2 += 3;
              break;
            case "u":
              i2 += 5;
              break;
            case "U":
              i2 += 9;
              break;
            default:
              i2 += 1;
          }
          escEnd = i2;
        }
        if (ch === "\n") {
          if (mode === FOLD_BLOCK)
            i2 = consumeMoreIndentedLines(text2, i2, indent.length);
          end = i2 + indent.length + endStep;
          split = void 0;
        } else {
          if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
            const next = text2[i2 + 1];
            if (next && next !== " " && next !== "\n" && next !== "	")
              split = i2;
          }
          if (i2 >= end) {
            if (split) {
              folds.push(split);
              end = split + endStep;
              split = void 0;
            } else if (mode === FOLD_QUOTED) {
              while (prev === " " || prev === "	") {
                prev = ch;
                ch = text2[i2 += 1];
                overflow = true;
              }
              const j = i2 > escEnd + 1 ? i2 - 2 : escStart - 1;
              if (escapedFolds[j])
                return text2;
              folds.push(j);
              escapedFolds[j] = true;
              end = j + endStep;
              split = void 0;
            } else {
              overflow = true;
            }
          }
        }
        prev = ch;
      }
      if (overflow && onOverflow)
        onOverflow();
      if (folds.length === 0)
        return text2;
      if (onFold)
        onFold();
      let res = text2.slice(0, folds[0]);
      for (let i3 = 0; i3 < folds.length; ++i3) {
        const fold = folds[i3];
        const end2 = folds[i3 + 1] || text2.length;
        if (fold === 0)
          res = `
${indent}${text2.slice(0, end2)}`;
        else {
          if (mode === FOLD_QUOTED && escapedFolds[fold])
            res += `${text2[fold]}\\`;
          res += `
${indent}${text2.slice(fold + 1, end2)}`;
        }
      }
      return res;
    }
    function consumeMoreIndentedLines(text2, i2, indent) {
      let end = i2;
      let start = i2 + 1;
      let ch = text2[start];
      while (ch === " " || ch === "	") {
        if (i2 < start + indent) {
          ch = text2[++i2];
        } else {
          do {
            ch = text2[++i2];
          } while (ch && ch !== "\n");
          end = i2;
          start = i2 + 1;
          ch = text2[start];
        }
      }
      return end;
    }
    exports.FOLD_BLOCK = FOLD_BLOCK;
    exports.FOLD_FLOW = FOLD_FLOW;
    exports.FOLD_QUOTED = FOLD_QUOTED;
    exports.foldFlowLines = foldFlowLines;
  }
});

// node_modules/yaml/dist/stringify/stringifyString.js
var require_stringifyString = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyString.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var foldFlowLines = require_foldFlowLines();
    var getFoldOptions = (ctx, isBlock) => ({
      indentAtStart: isBlock ? ctx.indent.length : ctx.indentAtStart,
      lineWidth: ctx.options.lineWidth,
      minContentWidth: ctx.options.minContentWidth
    });
    var containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
    function lineLengthOverLimit(str, lineWidth, indentLength) {
      if (!lineWidth || lineWidth < 0)
        return false;
      const limit = lineWidth - indentLength;
      const strLen = str.length;
      if (strLen <= limit)
        return false;
      for (let i2 = 0, start = 0; i2 < strLen; ++i2) {
        if (str[i2] === "\n") {
          if (i2 - start > limit)
            return true;
          start = i2 + 1;
          if (strLen - start <= limit)
            return false;
        }
      }
      return true;
    }
    function doubleQuotedString(value, ctx) {
      const json = JSON.stringify(value);
      if (ctx.options.doubleQuotedAsJSON)
        return json;
      const { implicitKey } = ctx;
      const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      let str = "";
      let start = 0;
      for (let i2 = 0, ch = json[i2]; ch; ch = json[++i2]) {
        if (ch === " " && json[i2 + 1] === "\\" && json[i2 + 2] === "n") {
          str += json.slice(start, i2) + "\\ ";
          i2 += 1;
          start = i2;
          ch = "\\";
        }
        if (ch === "\\")
          switch (json[i2 + 1]) {
            case "u":
              {
                str += json.slice(start, i2);
                const code = json.substr(i2 + 2, 4);
                switch (code) {
                  case "0000":
                    str += "\\0";
                    break;
                  case "0007":
                    str += "\\a";
                    break;
                  case "000b":
                    str += "\\v";
                    break;
                  case "001b":
                    str += "\\e";
                    break;
                  case "0085":
                    str += "\\N";
                    break;
                  case "00a0":
                    str += "\\_";
                    break;
                  case "2028":
                    str += "\\L";
                    break;
                  case "2029":
                    str += "\\P";
                    break;
                  default:
                    if (code.substr(0, 2) === "00")
                      str += "\\x" + code.substr(2);
                    else
                      str += json.substr(i2, 6);
                }
                i2 += 5;
                start = i2 + 1;
              }
              break;
            case "n":
              if (implicitKey || json[i2 + 2] === '"' || json.length < minMultiLineLength) {
                i2 += 1;
              } else {
                str += json.slice(start, i2) + "\n\n";
                while (json[i2 + 2] === "\\" && json[i2 + 3] === "n" && json[i2 + 4] !== '"') {
                  str += "\n";
                  i2 += 2;
                }
                str += indent;
                if (json[i2 + 2] === " ")
                  str += "\\";
                i2 += 1;
                start = i2 + 1;
              }
              break;
            default:
              i2 += 1;
          }
      }
      str = start ? str + json.slice(start) : json;
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_QUOTED, getFoldOptions(ctx, false));
    }
    function singleQuotedString(value, ctx) {
      if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value))
        return doubleQuotedString(value, ctx);
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&
${indent}`) + "'";
      return ctx.implicitKey ? res : foldFlowLines.foldFlowLines(res, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function quotedString(value, ctx) {
      const { singleQuote } = ctx.options;
      let qs;
      if (singleQuote === false)
        qs = doubleQuotedString;
      else {
        const hasDouble = value.includes('"');
        const hasSingle = value.includes("'");
        if (hasDouble && !hasSingle)
          qs = singleQuotedString;
        else if (hasSingle && !hasDouble)
          qs = doubleQuotedString;
        else
          qs = singleQuote ? singleQuotedString : doubleQuotedString;
      }
      return qs(value, ctx);
    }
    var blockEndNewlines;
    try {
      blockEndNewlines = new RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
    } catch {
      blockEndNewlines = /\n+(?!\n|$)/g;
    }
    function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
      const { blockQuote, commentString, lineWidth } = ctx.options;
      if (!blockQuote || /\n[\t ]+$/.test(value)) {
        return quotedString(value, ctx);
      }
      const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
      const literal = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.Scalar.BLOCK_FOLDED ? false : type === Scalar.Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
      if (!value)
        return literal ? "|\n" : ">\n";
      let chomp;
      let endStart;
      for (endStart = value.length; endStart > 0; --endStart) {
        const ch = value[endStart - 1];
        if (ch !== "\n" && ch !== "	" && ch !== " ")
          break;
      }
      let end = value.substring(endStart);
      const endNlPos = end.indexOf("\n");
      if (endNlPos === -1) {
        chomp = "-";
      } else if (value === end || endNlPos !== end.length - 1) {
        chomp = "+";
        if (onChompKeep)
          onChompKeep();
      } else {
        chomp = "";
      }
      if (end) {
        value = value.slice(0, -end.length);
        if (end[end.length - 1] === "\n")
          end = end.slice(0, -1);
        end = end.replace(blockEndNewlines, `$&${indent}`);
      }
      let startWithSpace = false;
      let startEnd;
      let startNlPos = -1;
      for (startEnd = 0; startEnd < value.length; ++startEnd) {
        const ch = value[startEnd];
        if (ch === " ")
          startWithSpace = true;
        else if (ch === "\n")
          startNlPos = startEnd;
        else
          break;
      }
      let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
      if (start) {
        value = value.substring(start.length);
        start = start.replace(/\n+/g, `$&${indent}`);
      }
      const indentSize = indent ? "2" : "1";
      let header = (startWithSpace ? indentSize : "") + chomp;
      if (comment) {
        header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " "));
        if (onComment)
          onComment();
      }
      if (!literal) {
        const foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`);
        let literalFallback = false;
        const foldOptions = getFoldOptions(ctx, true);
        if (blockQuote !== "folded" && type !== Scalar.Scalar.BLOCK_FOLDED) {
          foldOptions.onOverflow = () => {
            literalFallback = true;
          };
        }
        const body = foldFlowLines.foldFlowLines(`${start}${foldedValue}${end}`, indent, foldFlowLines.FOLD_BLOCK, foldOptions);
        if (!literalFallback)
          return `>${header}
${indent}${body}`;
      }
      value = value.replace(/\n+/g, `$&${indent}`);
      return `|${header}
${indent}${start}${value}${end}`;
    }
    function plainString(item, ctx, onComment, onChompKeep) {
      const { type, value } = item;
      const { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
      if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) {
        return quotedString(value, ctx);
      }
      if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) {
        return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
      }
      if (!implicitKey && !inFlow && type !== Scalar.Scalar.PLAIN && value.includes("\n")) {
        return blockString(item, ctx, onComment, onChompKeep);
      }
      if (containsDocumentMarker(value)) {
        if (indent === "") {
          ctx.forceBlockIndent = true;
          return blockString(item, ctx, onComment, onChompKeep);
        } else if (implicitKey && indent === indentStep) {
          return quotedString(value, ctx);
        }
      }
      const str = value.replace(/\n+/g, `$&
${indent}`);
      if (actualString) {
        const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str);
        const { compat, tags } = ctx.doc.schema;
        if (tags.some(test) || compat?.some(test))
          return quotedString(value, ctx);
      }
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function stringifyString(item, ctx, onComment, onChompKeep) {
      const { implicitKey, inFlow } = ctx;
      const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
      let { type } = item;
      if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
        if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value))
          type = Scalar.Scalar.QUOTE_DOUBLE;
      }
      const _stringify = (_type) => {
        switch (_type) {
          case Scalar.Scalar.BLOCK_FOLDED:
          case Scalar.Scalar.BLOCK_LITERAL:
            return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
          case Scalar.Scalar.QUOTE_DOUBLE:
            return doubleQuotedString(ss.value, ctx);
          case Scalar.Scalar.QUOTE_SINGLE:
            return singleQuotedString(ss.value, ctx);
          case Scalar.Scalar.PLAIN:
            return plainString(ss, ctx, onComment, onChompKeep);
          default:
            return null;
        }
      };
      let res = _stringify(type);
      if (res === null) {
        const { defaultKeyType, defaultStringType } = ctx.options;
        const t2 = implicitKey && defaultKeyType || defaultStringType;
        res = _stringify(t2);
        if (res === null)
          throw new Error(`Unsupported default string type ${t2}`);
      }
      return res;
    }
    exports.stringifyString = stringifyString;
  }
});

// node_modules/yaml/dist/stringify/stringify.js
var require_stringify = __commonJS({
  "node_modules/yaml/dist/stringify/stringify.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var identity = require_identity();
    var stringifyComment = require_stringifyComment();
    var stringifyString = require_stringifyString();
    function createStringifyContext(doc, options) {
      const opt = Object.assign({
        blockQuote: true,
        commentString: stringifyComment.stringifyComment,
        defaultKeyType: null,
        defaultStringType: "PLAIN",
        directives: null,
        doubleQuotedAsJSON: false,
        doubleQuotedMinMultiLineLength: 40,
        falseStr: "false",
        flowCollectionPadding: true,
        indentSeq: true,
        lineWidth: 80,
        minContentWidth: 20,
        nullStr: "null",
        simpleKeys: false,
        singleQuote: null,
        trailingComma: false,
        trueStr: "true",
        verifyAliasOrder: true
      }, doc.schema.toStringOptions, options);
      let inFlow;
      switch (opt.collectionStyle) {
        case "block":
          inFlow = false;
          break;
        case "flow":
          inFlow = true;
          break;
        default:
          inFlow = null;
      }
      return {
        anchors: /* @__PURE__ */ new Set(),
        doc,
        flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
        indent: "",
        indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
        inFlow,
        options: opt
      };
    }
    function getTagObject(tags, item) {
      if (item.tag) {
        const match = tags.filter((t2) => t2.tag === item.tag);
        if (match.length > 0)
          return match.find((t2) => t2.format === item.format) ?? match[0];
      }
      let tagObj = void 0;
      let obj;
      if (identity.isScalar(item)) {
        obj = item.value;
        let match = tags.filter((t2) => t2.identify?.(obj));
        if (match.length > 1) {
          const testMatch = match.filter((t2) => t2.test);
          if (testMatch.length > 0)
            match = testMatch;
        }
        tagObj = match.find((t2) => t2.format === item.format) ?? match.find((t2) => !t2.format);
      } else {
        obj = item;
        tagObj = tags.find((t2) => t2.nodeClass && obj instanceof t2.nodeClass);
      }
      if (!tagObj) {
        const name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
        throw new Error(`Tag not resolved for ${name} value`);
      }
      return tagObj;
    }
    function stringifyProps(node, tagObj, { anchors: anchors$1, doc }) {
      if (!doc.directives)
        return "";
      const props = [];
      const anchor = (identity.isScalar(node) || identity.isCollection(node)) && node.anchor;
      if (anchor && anchors.anchorIsValid(anchor)) {
        anchors$1.add(anchor);
        props.push(`&${anchor}`);
      }
      const tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
      if (tag)
        props.push(doc.directives.tagString(tag));
      return props.join(" ");
    }
    function stringify6(item, ctx, onComment, onChompKeep) {
      if (identity.isPair(item))
        return item.toString(ctx, onComment, onChompKeep);
      if (identity.isAlias(item)) {
        if (ctx.doc.directives)
          return item.toString(ctx);
        if (ctx.resolvedAliases?.has(item)) {
          throw new TypeError(`Cannot stringify circular structure without alias nodes`);
        } else {
          if (ctx.resolvedAliases)
            ctx.resolvedAliases.add(item);
          else
            ctx.resolvedAliases = /* @__PURE__ */ new Set([item]);
          item = item.resolve(ctx.doc);
        }
      }
      let tagObj = void 0;
      const node = identity.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
      tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
      const props = stringifyProps(node, tagObj, ctx);
      if (props.length > 0)
        ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
      const str = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : identity.isScalar(node) ? stringifyString.stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
      if (!props)
        return str;
      return identity.isScalar(node) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}
${ctx.indent}${str}`;
    }
    exports.createStringifyContext = createStringifyContext;
    exports.stringify = stringify6;
  }
});

// node_modules/yaml/dist/stringify/stringifyPair.js
var require_stringifyPair = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyPair.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var stringify6 = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
      const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
      let keyComment = identity.isNode(key) && key.comment || null;
      if (simpleKeys) {
        if (keyComment) {
          throw new Error("With simple keys, key nodes cannot have comments");
        }
        if (identity.isCollection(key) || !identity.isNode(key) && typeof key === "object") {
          const msg = "With simple keys, collection cannot be used as a key value";
          throw new Error(msg);
        }
      }
      let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || identity.isCollection(key) || (identity.isScalar(key) ? key.type === Scalar.Scalar.BLOCK_FOLDED || key.type === Scalar.Scalar.BLOCK_LITERAL : typeof key === "object"));
      ctx = Object.assign({}, ctx, {
        allNullValues: false,
        implicitKey: !explicitKey && (simpleKeys || !allNullValues),
        indent: indent + indentStep
      });
      let keyCommentDone = false;
      let chompKeep = false;
      let str = stringify6.stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
      if (!explicitKey && !ctx.inFlow && str.length > 1024) {
        if (simpleKeys)
          throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
        explicitKey = true;
      }
      if (ctx.inFlow) {
        if (allNullValues || value == null) {
          if (keyCommentDone && onComment)
            onComment();
          return str === "" ? "?" : explicitKey ? `? ${str}` : str;
        }
      } else if (allNullValues && !simpleKeys || value == null && explicitKey) {
        str = `? ${str}`;
        if (keyComment && !keyCommentDone) {
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        } else if (chompKeep && onChompKeep)
          onChompKeep();
        return str;
      }
      if (keyCommentDone)
        keyComment = null;
      if (explicitKey) {
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        str = `? ${str}
${indent}:`;
      } else {
        str = `${str}:`;
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
      }
      let vsb, vcb, valueComment;
      if (identity.isNode(value)) {
        vsb = !!value.spaceBefore;
        vcb = value.commentBefore;
        valueComment = value.comment;
      } else {
        vsb = false;
        vcb = null;
        valueComment = null;
        if (value && typeof value === "object")
          value = doc.createNode(value);
      }
      ctx.implicitKey = false;
      if (!explicitKey && !keyComment && identity.isScalar(value))
        ctx.indentAtStart = str.length + 1;
      chompKeep = false;
      if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && identity.isSeq(value) && !value.flow && !value.tag && !value.anchor) {
        ctx.indent = ctx.indent.substring(2);
      }
      let valueCommentDone = false;
      const valueStr = stringify6.stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
      let ws = " ";
      if (keyComment || vsb || vcb) {
        ws = vsb ? "\n" : "";
        if (vcb) {
          const cs = commentString(vcb);
          ws += `
${stringifyComment.indentComment(cs, ctx.indent)}`;
        }
        if (valueStr === "" && !ctx.inFlow) {
          if (ws === "\n" && valueComment)
            ws = "\n\n";
        } else {
          ws += `
${ctx.indent}`;
        }
      } else if (!explicitKey && identity.isCollection(value)) {
        const vs0 = valueStr[0];
        const nl0 = valueStr.indexOf("\n");
        const hasNewline = nl0 !== -1;
        const flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
        if (hasNewline || !flow) {
          let hasPropsLine = false;
          if (hasNewline && (vs0 === "&" || vs0 === "!")) {
            let sp0 = valueStr.indexOf(" ");
            if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") {
              sp0 = valueStr.indexOf(" ", sp0 + 1);
            }
            if (sp0 === -1 || nl0 < sp0)
              hasPropsLine = true;
          }
          if (!hasPropsLine)
            ws = `
${ctx.indent}`;
        }
      } else if (valueStr === "" || valueStr[0] === "\n") {
        ws = "";
      }
      str += ws + valueStr;
      if (ctx.inFlow) {
        if (valueCommentDone && onComment)
          onComment();
      } else if (valueComment && !valueCommentDone) {
        str += stringifyComment.lineComment(str, ctx.indent, commentString(valueComment));
      } else if (chompKeep && onChompKeep) {
        onChompKeep();
      }
      return str;
    }
    exports.stringifyPair = stringifyPair;
  }
});

// node_modules/yaml/dist/log.js
var require_log = __commonJS({
  "node_modules/yaml/dist/log.js"(exports) {
    "use strict";
    var node_process = __require("process");
    function debug(logLevel, ...messages) {
      if (logLevel === "debug")
        console.log(...messages);
    }
    function warn(logLevel, warning) {
      if (logLevel === "debug" || logLevel === "warn") {
        if (typeof node_process.emitWarning === "function")
          node_process.emitWarning(warning);
        else
          console.warn(warning);
      }
    }
    exports.debug = debug;
    exports.warn = warn;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/merge.js
var require_merge = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/merge.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var MERGE_KEY = "<<";
    var merge = {
      identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
      default: "key",
      tag: "tag:yaml.org,2002:merge",
      test: /^<<$/,
      resolve: () => Object.assign(new Scalar.Scalar(Symbol(MERGE_KEY)), {
        addToJSMap: addMergeToJSMap
      }),
      stringify: () => MERGE_KEY
    };
    var isMergeKey = (ctx, key) => (merge.identify(key) || identity.isScalar(key) && (!key.type || key.type === Scalar.Scalar.PLAIN) && merge.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge.tag && tag.default);
    function addMergeToJSMap(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (identity.isSeq(source))
        for (const it of source.items)
          mergeValue(ctx, map, it);
      else if (Array.isArray(source))
        for (const it of source)
          mergeValue(ctx, map, it);
      else
        mergeValue(ctx, map, source);
    }
    function mergeValue(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (!identity.isMap(source))
        throw new Error("Merge sources must be maps or map aliases");
      const srcMap = source.toJSON(null, ctx, Map);
      for (const [key, value2] of srcMap) {
        if (map instanceof Map) {
          if (!map.has(key))
            map.set(key, value2);
        } else if (map instanceof Set) {
          map.add(key);
        } else if (!Object.prototype.hasOwnProperty.call(map, key)) {
          Object.defineProperty(map, key, {
            value: value2,
            writable: true,
            enumerable: true,
            configurable: true
          });
        }
      }
      return map;
    }
    function resolveAliasValue(ctx, value) {
      return ctx && identity.isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
    }
    exports.addMergeToJSMap = addMergeToJSMap;
    exports.isMergeKey = isMergeKey;
    exports.merge = merge;
  }
});

// node_modules/yaml/dist/nodes/addPairToJSMap.js
var require_addPairToJSMap = __commonJS({
  "node_modules/yaml/dist/nodes/addPairToJSMap.js"(exports) {
    "use strict";
    var log = require_log();
    var merge = require_merge();
    var stringify6 = require_stringify();
    var identity = require_identity();
    var toJS = require_toJS();
    function addPairToJSMap(ctx, map, { key, value }) {
      if (identity.isNode(key) && key.addToJSMap)
        key.addToJSMap(ctx, map, value);
      else if (merge.isMergeKey(ctx, key))
        merge.addMergeToJSMap(ctx, map, value);
      else {
        const jsKey = toJS.toJS(key, "", ctx);
        if (map instanceof Map) {
          map.set(jsKey, toJS.toJS(value, jsKey, ctx));
        } else if (map instanceof Set) {
          map.add(jsKey);
        } else {
          const stringKey = stringifyKey(key, jsKey, ctx);
          const jsValue = toJS.toJS(value, stringKey, ctx);
          if (stringKey in map)
            Object.defineProperty(map, stringKey, {
              value: jsValue,
              writable: true,
              enumerable: true,
              configurable: true
            });
          else
            map[stringKey] = jsValue;
        }
      }
      return map;
    }
    function stringifyKey(key, jsKey, ctx) {
      if (jsKey === null)
        return "";
      if (typeof jsKey !== "object")
        return String(jsKey);
      if (identity.isNode(key) && ctx?.doc) {
        const strCtx = stringify6.createStringifyContext(ctx.doc, {});
        strCtx.anchors = /* @__PURE__ */ new Set();
        for (const node of ctx.anchors.keys())
          strCtx.anchors.add(node.anchor);
        strCtx.inFlow = true;
        strCtx.inStringifyKey = true;
        const strKey = key.toString(strCtx);
        if (!ctx.mapKeyWarned) {
          let jsonStr = JSON.stringify(strKey);
          if (jsonStr.length > 40)
            jsonStr = jsonStr.substring(0, 36) + '..."';
          log.warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
          ctx.mapKeyWarned = true;
        }
        return strKey;
      }
      return JSON.stringify(jsKey);
    }
    exports.addPairToJSMap = addPairToJSMap;
  }
});

// node_modules/yaml/dist/nodes/Pair.js
var require_Pair = __commonJS({
  "node_modules/yaml/dist/nodes/Pair.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var stringifyPair = require_stringifyPair();
    var addPairToJSMap = require_addPairToJSMap();
    var identity = require_identity();
    function createPair(key, value, ctx) {
      const k = createNode.createNode(key, void 0, ctx);
      const v = createNode.createNode(value, void 0, ctx);
      return new Pair(k, v);
    }
    var Pair = class _Pair {
      constructor(key, value = null) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.PAIR });
        this.key = key;
        this.value = value;
      }
      clone(schema) {
        let { key, value } = this;
        if (identity.isNode(key))
          key = key.clone(schema);
        if (identity.isNode(value))
          value = value.clone(schema);
        return new _Pair(key, value);
      }
      toJSON(_, ctx) {
        const pair = ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        return addPairToJSMap.addPairToJSMap(ctx, pair, this);
      }
      toString(ctx, onComment, onChompKeep) {
        return ctx?.doc ? stringifyPair.stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
      }
    };
    exports.Pair = Pair;
    exports.createPair = createPair;
  }
});

// node_modules/yaml/dist/stringify/stringifyCollection.js
var require_stringifyCollection = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyCollection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var stringify6 = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyCollection(collection, ctx, options) {
      const flow = ctx.inFlow ?? collection.flow;
      const stringify7 = flow ? stringifyFlowCollection : stringifyBlockCollection;
      return stringify7(collection, ctx, options);
    }
    function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
      const { indent, options: { commentString } } = ctx;
      const itemCtx = Object.assign({}, ctx, { indent: itemIndent, type: null });
      let chompKeep = false;
      const lines = [];
      for (let i2 = 0; i2 < items.length; ++i2) {
        const item = items[i2];
        let comment2 = null;
        if (identity.isNode(item)) {
          if (!chompKeep && item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
          if (item.comment)
            comment2 = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (!chompKeep && ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
          }
        }
        chompKeep = false;
        let str2 = stringify6.stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
        if (comment2)
          str2 += stringifyComment.lineComment(str2, itemIndent, commentString(comment2));
        if (chompKeep && comment2)
          chompKeep = false;
        lines.push(blockItemPrefix + str2);
      }
      let str;
      if (lines.length === 0) {
        str = flowChars.start + flowChars.end;
      } else {
        str = lines[0];
        for (let i2 = 1; i2 < lines.length; ++i2) {
          const line = lines[i2];
          str += line ? `
${indent}${line}` : "\n";
        }
      }
      if (comment) {
        str += "\n" + stringifyComment.indentComment(commentString(comment), indent);
        if (onComment)
          onComment();
      } else if (chompKeep && onChompKeep)
        onChompKeep();
      return str;
    }
    function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
      const { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
      itemIndent += indentStep;
      const itemCtx = Object.assign({}, ctx, {
        indent: itemIndent,
        inFlow: true,
        type: null
      });
      let reqNewline = false;
      let linesAtValue = 0;
      const lines = [];
      for (let i2 = 0; i2 < items.length; ++i2) {
        const item = items[i2];
        let comment = null;
        if (identity.isNode(item)) {
          if (item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, false);
          if (item.comment)
            comment = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, false);
            if (ik.comment)
              reqNewline = true;
          }
          const iv = identity.isNode(item.value) ? item.value : null;
          if (iv) {
            if (iv.comment)
              comment = iv.comment;
            if (iv.commentBefore)
              reqNewline = true;
          } else if (item.value == null && ik?.comment) {
            comment = ik.comment;
          }
        }
        if (comment)
          reqNewline = true;
        let str = stringify6.stringify(item, itemCtx, () => comment = null);
        reqNewline || (reqNewline = lines.length > linesAtValue || str.includes("\n"));
        if (i2 < items.length - 1) {
          str += ",";
        } else if (ctx.options.trailingComma) {
          if (ctx.options.lineWidth > 0) {
            reqNewline || (reqNewline = lines.reduce((sum, line) => sum + line.length + 2, 2) + (str.length + 2) > ctx.options.lineWidth);
          }
          if (reqNewline) {
            str += ",";
          }
        }
        if (comment)
          str += stringifyComment.lineComment(str, itemIndent, commentString(comment));
        lines.push(str);
        linesAtValue = lines.length;
      }
      const { start, end } = flowChars;
      if (lines.length === 0) {
        return start + end;
      } else {
        if (!reqNewline) {
          const len = lines.reduce((sum, line) => sum + line.length + 2, 2);
          reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
        }
        if (reqNewline) {
          let str = start;
          for (const line of lines)
            str += line ? `
${indentStep}${indent}${line}` : "\n";
          return `${str}
${indent}${end}`;
        } else {
          return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
        }
      }
    }
    function addCommentBefore({ indent, options: { commentString } }, lines, comment, chompKeep) {
      if (comment && chompKeep)
        comment = comment.replace(/^\n+/, "");
      if (comment) {
        const ic = stringifyComment.indentComment(commentString(comment), indent);
        lines.push(ic.trimStart());
      }
    }
    exports.stringifyCollection = stringifyCollection;
  }
});

// node_modules/yaml/dist/nodes/YAMLMap.js
var require_YAMLMap = __commonJS({
  "node_modules/yaml/dist/nodes/YAMLMap.js"(exports) {
    "use strict";
    var stringifyCollection = require_stringifyCollection();
    var addPairToJSMap = require_addPairToJSMap();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    function findPair(items, key) {
      const k = identity.isScalar(key) ? key.value : key;
      for (const it of items) {
        if (identity.isPair(it)) {
          if (it.key === key || it.key === k)
            return it;
          if (identity.isScalar(it.key) && it.key.value === k)
            return it;
        }
      }
      return void 0;
    }
    var YAMLMap = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:map";
      }
      constructor(schema) {
        super(identity.MAP, schema);
        this.items = [];
      }
      /**
       * A generic collection parsing method that can be extended
       * to other node classes that inherit from YAMLMap
       */
      static from(schema, obj, ctx) {
        const { keepUndefined, replacer } = ctx;
        const map = new this(schema);
        const add = (key, value) => {
          if (typeof replacer === "function")
            value = replacer.call(obj, key, value);
          else if (Array.isArray(replacer) && !replacer.includes(key))
            return;
          if (value !== void 0 || keepUndefined)
            map.items.push(Pair.createPair(key, value, ctx));
        };
        if (obj instanceof Map) {
          for (const [key, value] of obj)
            add(key, value);
        } else if (obj && typeof obj === "object") {
          for (const key of Object.keys(obj))
            add(key, obj[key]);
        }
        if (typeof schema.sortMapEntries === "function") {
          map.items.sort(schema.sortMapEntries);
        }
        return map;
      }
      /**
       * Adds a value to the collection.
       *
       * @param overwrite - If not set `true`, using a key that is already in the
       *   collection will throw. Otherwise, overwrites the previous value.
       */
      add(pair, overwrite) {
        let _pair;
        if (identity.isPair(pair))
          _pair = pair;
        else if (!pair || typeof pair !== "object" || !("key" in pair)) {
          _pair = new Pair.Pair(pair, pair?.value);
        } else
          _pair = new Pair.Pair(pair.key, pair.value);
        const prev = findPair(this.items, _pair.key);
        const sortEntries = this.schema?.sortMapEntries;
        if (prev) {
          if (!overwrite)
            throw new Error(`Key ${_pair.key} already set`);
          if (identity.isScalar(prev.value) && Scalar.isScalarValue(_pair.value))
            prev.value.value = _pair.value;
          else
            prev.value = _pair.value;
        } else if (sortEntries) {
          const i2 = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
          if (i2 === -1)
            this.items.push(_pair);
          else
            this.items.splice(i2, 0, _pair);
        } else {
          this.items.push(_pair);
        }
      }
      delete(key) {
        const it = findPair(this.items, key);
        if (!it)
          return false;
        const del = this.items.splice(this.items.indexOf(it), 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const it = findPair(this.items, key);
        const node = it?.value;
        return (!keepScalar && identity.isScalar(node) ? node.value : node) ?? void 0;
      }
      has(key) {
        return !!findPair(this.items, key);
      }
      set(key, value) {
        this.add(new Pair.Pair(key, value), true);
      }
      /**
       * @param ctx - Conversion context, originally set in Document#toJS()
       * @param {Class} Type - If set, forces the returned collection type
       * @returns Instance of Type, Map, or Object
       */
      toJSON(_, ctx, Type) {
        const map = Type ? new Type() : ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const item of this.items)
          addPairToJSMap.addPairToJSMap(ctx, map, item);
        return map;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        for (const item of this.items) {
          if (!identity.isPair(item))
            throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
        }
        if (!ctx.allNullValues && this.hasAllNullValues(false))
          ctx = Object.assign({}, ctx, { allNullValues: true });
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "",
          flowChars: { start: "{", end: "}" },
          itemIndent: ctx.indent || "",
          onChompKeep,
          onComment
        });
      }
    };
    exports.YAMLMap = YAMLMap;
    exports.findPair = findPair;
  }
});

// node_modules/yaml/dist/schema/common/map.js
var require_map = __commonJS({
  "node_modules/yaml/dist/schema/common/map.js"(exports) {
    "use strict";
    var identity = require_identity();
    var YAMLMap = require_YAMLMap();
    var map = {
      collection: "map",
      default: true,
      nodeClass: YAMLMap.YAMLMap,
      tag: "tag:yaml.org,2002:map",
      resolve(map2, onError) {
        if (!identity.isMap(map2))
          onError("Expected a mapping for this tag");
        return map2;
      },
      createNode: (schema, obj, ctx) => YAMLMap.YAMLMap.from(schema, obj, ctx)
    };
    exports.map = map;
  }
});

// node_modules/yaml/dist/nodes/YAMLSeq.js
var require_YAMLSeq = __commonJS({
  "node_modules/yaml/dist/nodes/YAMLSeq.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var stringifyCollection = require_stringifyCollection();
    var Collection = require_Collection();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var toJS = require_toJS();
    var YAMLSeq = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:seq";
      }
      constructor(schema) {
        super(identity.SEQ, schema);
        this.items = [];
      }
      add(value) {
        this.items.push(value);
      }
      /**
       * Removes a value from the collection.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       *
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return false;
        const del = this.items.splice(idx, 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return void 0;
        const it = this.items[idx];
        return !keepScalar && identity.isScalar(it) ? it.value : it;
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       */
      has(key) {
        const idx = asItemIndex(key);
        return typeof idx === "number" && idx < this.items.length;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       *
       * If `key` does not contain a representation of an integer, this will throw.
       * It may be wrapped in a `Scalar`.
       */
      set(key, value) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          throw new Error(`Expected a valid index, not ${key}.`);
        const prev = this.items[idx];
        if (identity.isScalar(prev) && Scalar.isScalarValue(value))
          prev.value = value;
        else
          this.items[idx] = value;
      }
      toJSON(_, ctx) {
        const seq = [];
        if (ctx?.onCreate)
          ctx.onCreate(seq);
        let i2 = 0;
        for (const item of this.items)
          seq.push(toJS.toJS(item, String(i2++), ctx));
        return seq;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "- ",
          flowChars: { start: "[", end: "]" },
          itemIndent: (ctx.indent || "") + "  ",
          onChompKeep,
          onComment
        });
      }
      static from(schema, obj, ctx) {
        const { replacer } = ctx;
        const seq = new this(schema);
        if (obj && Symbol.iterator in Object(obj)) {
          let i2 = 0;
          for (let it of obj) {
            if (typeof replacer === "function") {
              const key = obj instanceof Set ? it : String(i2++);
              it = replacer.call(obj, key, it);
            }
            seq.items.push(createNode.createNode(it, void 0, ctx));
          }
        }
        return seq;
      }
    };
    function asItemIndex(key) {
      let idx = identity.isScalar(key) ? key.value : key;
      if (idx && typeof idx === "string")
        idx = Number(idx);
      return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
    }
    exports.YAMLSeq = YAMLSeq;
  }
});

// node_modules/yaml/dist/schema/common/seq.js
var require_seq = __commonJS({
  "node_modules/yaml/dist/schema/common/seq.js"(exports) {
    "use strict";
    var identity = require_identity();
    var YAMLSeq = require_YAMLSeq();
    var seq = {
      collection: "seq",
      default: true,
      nodeClass: YAMLSeq.YAMLSeq,
      tag: "tag:yaml.org,2002:seq",
      resolve(seq2, onError) {
        if (!identity.isSeq(seq2))
          onError("Expected a sequence for this tag");
        return seq2;
      },
      createNode: (schema, obj, ctx) => YAMLSeq.YAMLSeq.from(schema, obj, ctx)
    };
    exports.seq = seq;
  }
});

// node_modules/yaml/dist/schema/common/string.js
var require_string = __commonJS({
  "node_modules/yaml/dist/schema/common/string.js"(exports) {
    "use strict";
    var stringifyString = require_stringifyString();
    var string = {
      identify: (value) => typeof value === "string",
      default: true,
      tag: "tag:yaml.org,2002:str",
      resolve: (str) => str,
      stringify(item, ctx, onComment, onChompKeep) {
        ctx = Object.assign({ actualString: true }, ctx);
        return stringifyString.stringifyString(item, ctx, onComment, onChompKeep);
      }
    };
    exports.string = string;
  }
});

// node_modules/yaml/dist/schema/common/null.js
var require_null = __commonJS({
  "node_modules/yaml/dist/schema/common/null.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var nullTag = {
      identify: (value) => value == null,
      createNode: () => new Scalar.Scalar(null),
      default: true,
      tag: "tag:yaml.org,2002:null",
      test: /^(?:~|[Nn]ull|NULL)?$/,
      resolve: () => new Scalar.Scalar(null),
      stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
    };
    exports.nullTag = nullTag;
  }
});

// node_modules/yaml/dist/schema/core/bool.js
var require_bool = __commonJS({
  "node_modules/yaml/dist/schema/core/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var boolTag = {
      identify: (value) => typeof value === "boolean",
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
      resolve: (str) => new Scalar.Scalar(str[0] === "t" || str[0] === "T"),
      stringify({ source, value }, ctx) {
        if (source && boolTag.test.test(source)) {
          const sv = source[0] === "t" || source[0] === "T";
          if (value === sv)
            return source;
        }
        return value ? ctx.options.trueStr : ctx.options.falseStr;
      }
    };
    exports.boolTag = boolTag;
  }
});

// node_modules/yaml/dist/stringify/stringifyNumber.js
var require_stringifyNumber = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyNumber.js"(exports) {
    "use strict";
    function stringifyNumber({ format, minFractionDigits, tag, value }) {
      if (typeof value === "bigint")
        return String(value);
      const num = typeof value === "number" ? value : Number(value);
      if (!isFinite(num))
        return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
      let n3 = Object.is(value, -0) ? "-0" : JSON.stringify(value);
      if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n3) && !n3.includes("e")) {
        let i2 = n3.indexOf(".");
        if (i2 < 0) {
          i2 = n3.length;
          n3 += ".";
        }
        let d = minFractionDigits - (n3.length - i2 - 1);
        while (d-- > 0)
          n3 += "0";
      }
      return n3;
    }
    exports.stringifyNumber = stringifyNumber;
  }
});

// node_modules/yaml/dist/schema/core/float.js
var require_float = __commonJS({
  "node_modules/yaml/dist/schema/core/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str));
        const dot = str.indexOf(".");
        if (dot !== -1 && str[str.length - 1] === "0")
          node.minFractionDigits = str.length - dot - 1;
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// node_modules/yaml/dist/schema/core/int.js
var require_int = __commonJS({
  "node_modules/yaml/dist/schema/core/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    var intResolve = (str, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str.substring(offset), radix);
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value) && value >= 0)
        return prefix + value.toString(radix);
      return stringifyNumber.stringifyNumber(node);
    }
    var intOct = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^0o[0-7]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 8, opt),
      stringify: (node) => intStringify(node, 8, "0o")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^0x[0-9a-fA-F]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// node_modules/yaml/dist/schema/core/schema.js
var require_schema = __commonJS({
  "node_modules/yaml/dist/schema/core/schema.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.boolTag,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float
    ];
    exports.schema = schema;
  }
});

// node_modules/yaml/dist/schema/json/schema.js
var require_schema2 = __commonJS({
  "node_modules/yaml/dist/schema/json/schema.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var map = require_map();
    var seq = require_seq();
    function intIdentify(value) {
      return typeof value === "bigint" || Number.isInteger(value);
    }
    var stringifyJSON = ({ value }) => JSON.stringify(value);
    var jsonScalars = [
      {
        identify: (value) => typeof value === "string",
        default: true,
        tag: "tag:yaml.org,2002:str",
        resolve: (str) => str,
        stringify: stringifyJSON
      },
      {
        identify: (value) => value == null,
        createNode: () => new Scalar.Scalar(null),
        default: true,
        tag: "tag:yaml.org,2002:null",
        test: /^null$/,
        resolve: () => null,
        stringify: stringifyJSON
      },
      {
        identify: (value) => typeof value === "boolean",
        default: true,
        tag: "tag:yaml.org,2002:bool",
        test: /^true$|^false$/,
        resolve: (str) => str === "true",
        stringify: stringifyJSON
      },
      {
        identify: intIdentify,
        default: true,
        tag: "tag:yaml.org,2002:int",
        test: /^-?(?:0|[1-9][0-9]*)$/,
        resolve: (str, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str, 10),
        stringify: ({ value }) => intIdentify(value) ? value.toString() : JSON.stringify(value)
      },
      {
        identify: (value) => typeof value === "number",
        default: true,
        tag: "tag:yaml.org,2002:float",
        test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
        resolve: (str) => parseFloat(str),
        stringify: stringifyJSON
      }
    ];
    var jsonError = {
      default: true,
      tag: "",
      test: /^/,
      resolve(str, onError) {
        onError(`Unresolved plain scalar ${JSON.stringify(str)}`);
        return str;
      }
    };
    var schema = [map.map, seq.seq].concat(jsonScalars, jsonError);
    exports.schema = schema;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/binary.js
var require_binary = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/binary.js"(exports) {
    "use strict";
    var node_buffer = __require("buffer");
    var Scalar = require_Scalar();
    var stringifyString = require_stringifyString();
    var binary = {
      identify: (value) => value instanceof Uint8Array,
      // Buffer inherits from Uint8Array
      default: false,
      tag: "tag:yaml.org,2002:binary",
      /**
       * Returns a Buffer in node and an Uint8Array in browsers
       *
       * To use the resulting buffer as an image, you'll want to do something like:
       *
       *   const blob = new Blob([buffer], { type: 'image/jpeg' })
       *   document.querySelector('#photo').src = URL.createObjectURL(blob)
       */
      resolve(src, onError) {
        if (typeof node_buffer.Buffer === "function") {
          return node_buffer.Buffer.from(src, "base64");
        } else if (typeof atob === "function") {
          const str = atob(src.replace(/[\n\r]/g, ""));
          const buffer = new Uint8Array(str.length);
          for (let i2 = 0; i2 < str.length; ++i2)
            buffer[i2] = str.charCodeAt(i2);
          return buffer;
        } else {
          onError("This environment does not support reading binary tags; either Buffer or atob is required");
          return src;
        }
      },
      stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
        if (!value)
          return "";
        const buf = value;
        let str;
        if (typeof node_buffer.Buffer === "function") {
          str = buf instanceof node_buffer.Buffer ? buf.toString("base64") : node_buffer.Buffer.from(buf.buffer).toString("base64");
        } else if (typeof btoa === "function") {
          let s = "";
          for (let i2 = 0; i2 < buf.length; ++i2)
            s += String.fromCharCode(buf[i2]);
          str = btoa(s);
        } else {
          throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
        }
        type ?? (type = Scalar.Scalar.BLOCK_LITERAL);
        if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
          const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
          const n3 = Math.ceil(str.length / lineWidth);
          const lines = new Array(n3);
          for (let i2 = 0, o = 0; i2 < n3; ++i2, o += lineWidth) {
            lines[i2] = str.substr(o, lineWidth);
          }
          str = lines.join(type === Scalar.Scalar.BLOCK_LITERAL ? "\n" : " ");
        }
        return stringifyString.stringifyString({ comment, type, value: str }, ctx, onComment, onChompKeep);
      }
    };
    exports.binary = binary;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/pairs.js
var require_pairs = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/pairs.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLSeq = require_YAMLSeq();
    function resolvePairs(seq, onError) {
      if (identity.isSeq(seq)) {
        for (let i2 = 0; i2 < seq.items.length; ++i2) {
          let item = seq.items[i2];
          if (identity.isPair(item))
            continue;
          else if (identity.isMap(item)) {
            if (item.items.length > 1)
              onError("Each pair must have its own sequence indicator");
            const pair = item.items[0] || new Pair.Pair(new Scalar.Scalar(null));
            if (item.commentBefore)
              pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}
${pair.key.commentBefore}` : item.commentBefore;
            if (item.comment) {
              const cn = pair.value ?? pair.key;
              cn.comment = cn.comment ? `${item.comment}
${cn.comment}` : item.comment;
            }
            item = pair;
          }
          seq.items[i2] = identity.isPair(item) ? item : new Pair.Pair(item);
        }
      } else
        onError("Expected a sequence for this tag");
      return seq;
    }
    function createPairs(schema, iterable, ctx) {
      const { replacer } = ctx;
      const pairs2 = new YAMLSeq.YAMLSeq(schema);
      pairs2.tag = "tag:yaml.org,2002:pairs";
      let i2 = 0;
      if (iterable && Symbol.iterator in Object(iterable))
        for (let it of iterable) {
          if (typeof replacer === "function")
            it = replacer.call(iterable, String(i2++), it);
          let key, value;
          if (Array.isArray(it)) {
            if (it.length === 2) {
              key = it[0];
              value = it[1];
            } else
              throw new TypeError(`Expected [key, value] tuple: ${it}`);
          } else if (it && it instanceof Object) {
            const keys = Object.keys(it);
            if (keys.length === 1) {
              key = keys[0];
              value = it[key];
            } else {
              throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
            }
          } else {
            key = it;
          }
          pairs2.items.push(Pair.createPair(key, value, ctx));
        }
      return pairs2;
    }
    var pairs = {
      collection: "seq",
      default: false,
      tag: "tag:yaml.org,2002:pairs",
      resolve: resolvePairs,
      createNode: createPairs
    };
    exports.createPairs = createPairs;
    exports.pairs = pairs;
    exports.resolvePairs = resolvePairs;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/omap.js
var require_omap = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/omap.js"(exports) {
    "use strict";
    var identity = require_identity();
    var toJS = require_toJS();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var pairs = require_pairs();
    var YAMLOMap = class _YAMLOMap extends YAMLSeq.YAMLSeq {
      constructor() {
        super();
        this.add = YAMLMap.YAMLMap.prototype.add.bind(this);
        this.delete = YAMLMap.YAMLMap.prototype.delete.bind(this);
        this.get = YAMLMap.YAMLMap.prototype.get.bind(this);
        this.has = YAMLMap.YAMLMap.prototype.has.bind(this);
        this.set = YAMLMap.YAMLMap.prototype.set.bind(this);
        this.tag = _YAMLOMap.tag;
      }
      /**
       * If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
       * but TypeScript won't allow widening the signature of a child method.
       */
      toJSON(_, ctx) {
        if (!ctx)
          return super.toJSON(_);
        const map = /* @__PURE__ */ new Map();
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const pair of this.items) {
          let key, value;
          if (identity.isPair(pair)) {
            key = toJS.toJS(pair.key, "", ctx);
            value = toJS.toJS(pair.value, key, ctx);
          } else {
            key = toJS.toJS(pair, "", ctx);
          }
          if (map.has(key))
            throw new Error("Ordered maps must not include duplicate keys");
          map.set(key, value);
        }
        return map;
      }
      static from(schema, iterable, ctx) {
        const pairs$1 = pairs.createPairs(schema, iterable, ctx);
        const omap2 = new this();
        omap2.items = pairs$1.items;
        return omap2;
      }
    };
    YAMLOMap.tag = "tag:yaml.org,2002:omap";
    var omap = {
      collection: "seq",
      identify: (value) => value instanceof Map,
      nodeClass: YAMLOMap,
      default: false,
      tag: "tag:yaml.org,2002:omap",
      resolve(seq, onError) {
        const pairs$1 = pairs.resolvePairs(seq, onError);
        const seenKeys = [];
        for (const { key } of pairs$1.items) {
          if (identity.isScalar(key)) {
            if (seenKeys.includes(key.value)) {
              onError(`Ordered maps must not include duplicate keys: ${key.value}`);
            } else {
              seenKeys.push(key.value);
            }
          }
        }
        return Object.assign(new YAMLOMap(), pairs$1);
      },
      createNode: (schema, iterable, ctx) => YAMLOMap.from(schema, iterable, ctx)
    };
    exports.YAMLOMap = YAMLOMap;
    exports.omap = omap;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/bool.js
var require_bool2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function boolStringify({ value, source }, ctx) {
      const boolObj = value ? trueTag : falseTag;
      if (source && boolObj.test.test(source))
        return source;
      return value ? ctx.options.trueStr : ctx.options.falseStr;
    }
    var trueTag = {
      identify: (value) => value === true,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
      resolve: () => new Scalar.Scalar(true),
      stringify: boolStringify
    };
    var falseTag = {
      identify: (value) => value === false,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
      resolve: () => new Scalar.Scalar(false),
      stringify: boolStringify
    };
    exports.falseTag = falseTag;
    exports.trueTag = trueTag;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/float.js
var require_float2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str.replace(/_/g, "")),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str.replace(/_/g, "")));
        const dot = str.indexOf(".");
        if (dot !== -1) {
          const f = str.substring(dot + 1).replace(/_/g, "");
          if (f[f.length - 1] === "0")
            node.minFractionDigits = f.length;
        }
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/int.js
var require_int2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    function intResolve(str, offset, radix, { intAsBigInt }) {
      const sign = str[0];
      if (sign === "-" || sign === "+")
        offset += 1;
      str = str.substring(offset).replace(/_/g, "");
      if (intAsBigInt) {
        switch (radix) {
          case 2:
            str = `0b${str}`;
            break;
          case 8:
            str = `0o${str}`;
            break;
          case 16:
            str = `0x${str}`;
            break;
        }
        const n4 = BigInt(str);
        return sign === "-" ? BigInt(-1) * n4 : n4;
      }
      const n3 = parseInt(str, radix);
      return sign === "-" ? -1 * n3 : n3;
    }
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value)) {
        const str = value.toString(radix);
        return value < 0 ? "-" + prefix + str.substr(1) : prefix + str;
      }
      return stringifyNumber.stringifyNumber(node);
    }
    var intBin = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "BIN",
      test: /^[-+]?0b[0-1_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 2, opt),
      stringify: (node) => intStringify(node, 2, "0b")
    };
    var intOct = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^[-+]?0[0-7_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 1, 8, opt),
      stringify: (node) => intStringify(node, 8, "0")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9][0-9_]*$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^[-+]?0x[0-9a-fA-F_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intBin = intBin;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/set.js
var require_set = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/set.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSet = class _YAMLSet extends YAMLMap.YAMLMap {
      constructor(schema) {
        super(schema);
        this.tag = _YAMLSet.tag;
      }
      add(key) {
        let pair;
        if (identity.isPair(key))
          pair = key;
        else if (key && typeof key === "object" && "key" in key && "value" in key && key.value === null)
          pair = new Pair.Pair(key.key, null);
        else
          pair = new Pair.Pair(key, null);
        const prev = YAMLMap.findPair(this.items, pair.key);
        if (!prev)
          this.items.push(pair);
      }
      /**
       * If `keepPair` is `true`, returns the Pair matching `key`.
       * Otherwise, returns the value of that Pair's key.
       */
      get(key, keepPair) {
        const pair = YAMLMap.findPair(this.items, key);
        return !keepPair && identity.isPair(pair) ? identity.isScalar(pair.key) ? pair.key.value : pair.key : pair;
      }
      set(key, value) {
        if (typeof value !== "boolean")
          throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
        const prev = YAMLMap.findPair(this.items, key);
        if (prev && !value) {
          this.items.splice(this.items.indexOf(prev), 1);
        } else if (!prev && value) {
          this.items.push(new Pair.Pair(key));
        }
      }
      toJSON(_, ctx) {
        return super.toJSON(_, ctx, Set);
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        if (this.hasAllNullValues(true))
          return super.toString(Object.assign({}, ctx, { allNullValues: true }), onComment, onChompKeep);
        else
          throw new Error("Set items must all have null values");
      }
      static from(schema, iterable, ctx) {
        const { replacer } = ctx;
        const set2 = new this(schema);
        if (iterable && Symbol.iterator in Object(iterable))
          for (let value of iterable) {
            if (typeof replacer === "function")
              value = replacer.call(iterable, value, value);
            set2.items.push(Pair.createPair(value, null, ctx));
          }
        return set2;
      }
    };
    YAMLSet.tag = "tag:yaml.org,2002:set";
    var set = {
      collection: "map",
      identify: (value) => value instanceof Set,
      nodeClass: YAMLSet,
      default: false,
      tag: "tag:yaml.org,2002:set",
      createNode: (schema, iterable, ctx) => YAMLSet.from(schema, iterable, ctx),
      resolve(map, onError) {
        if (identity.isMap(map)) {
          if (map.hasAllNullValues(true))
            return Object.assign(new YAMLSet(), map);
          else
            onError("Set items must all have null values");
        } else
          onError("Expected a mapping for this tag");
        return map;
      }
    };
    exports.YAMLSet = YAMLSet;
    exports.set = set;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/timestamp.js
var require_timestamp = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/timestamp.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    function parseSexagesimal(str, asBigInt) {
      const sign = str[0];
      const parts = sign === "-" || sign === "+" ? str.substring(1) : str;
      const num = (n3) => asBigInt ? BigInt(n3) : Number(n3);
      const res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num(60) + num(p), num(0));
      return sign === "-" ? num(-1) * res : res;
    }
    function stringifySexagesimal(node) {
      let { value } = node;
      let num = (n3) => n3;
      if (typeof value === "bigint")
        num = (n3) => BigInt(n3);
      else if (isNaN(value) || !isFinite(value))
        return stringifyNumber.stringifyNumber(node);
      let sign = "";
      if (value < 0) {
        sign = "-";
        value *= num(-1);
      }
      const _60 = num(60);
      const parts = [value % _60];
      if (value < 60) {
        parts.unshift(0);
      } else {
        value = (value - parts[0]) / _60;
        parts.unshift(value % _60);
        if (value >= 60) {
          value = (value - parts[0]) / _60;
          parts.unshift(value);
        }
      }
      return sign + parts.map((n3) => String(n3).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
    }
    var intTime = {
      identify: (value) => typeof value === "bigint" || Number.isInteger(value),
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
      resolve: (str, _onError, { intAsBigInt }) => parseSexagesimal(str, intAsBigInt),
      stringify: stringifySexagesimal
    };
    var floatTime = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
      resolve: (str) => parseSexagesimal(str, false),
      stringify: stringifySexagesimal
    };
    var timestamp = {
      identify: (value) => value instanceof Date,
      default: true,
      tag: "tag:yaml.org,2002:timestamp",
      // If the time zone is omitted, the timestamp is assumed to be specified in UTC. The time part
      // may be omitted altogether, resulting in a date format. In such a case, the time part is
      // assumed to be 00:00:00Z (start of day, UTC).
      test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
      resolve(str) {
        const match = str.match(timestamp.test);
        if (!match)
          throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
        const [, year, month, day, hour, minute, second] = match.map(Number);
        const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
        let date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
        const tz = match[8];
        if (tz && tz !== "Z") {
          let d = parseSexagesimal(tz, false);
          if (Math.abs(d) < 30)
            d *= 60;
          date -= 6e4 * d;
        }
        return new Date(date);
      },
      stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
    };
    exports.floatTime = floatTime;
    exports.intTime = intTime;
    exports.timestamp = timestamp;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/schema.js
var require_schema3 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/schema.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var binary = require_binary();
    var bool = require_bool2();
    var float = require_float2();
    var int = require_int2();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var set = require_set();
    var timestamp = require_timestamp();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.trueTag,
      bool.falseTag,
      int.intBin,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float,
      binary.binary,
      merge.merge,
      omap.omap,
      pairs.pairs,
      set.set,
      timestamp.intTime,
      timestamp.floatTime,
      timestamp.timestamp
    ];
    exports.schema = schema;
  }
});

// node_modules/yaml/dist/schema/tags.js
var require_tags = __commonJS({
  "node_modules/yaml/dist/schema/tags.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = require_schema();
    var schema$1 = require_schema2();
    var binary = require_binary();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var schema$2 = require_schema3();
    var set = require_set();
    var timestamp = require_timestamp();
    var schemas = /* @__PURE__ */ new Map([
      ["core", schema.schema],
      ["failsafe", [map.map, seq.seq, string.string]],
      ["json", schema$1.schema],
      ["yaml11", schema$2.schema],
      ["yaml-1.1", schema$2.schema]
    ]);
    var tagsByName = {
      binary: binary.binary,
      bool: bool.boolTag,
      float: float.float,
      floatExp: float.floatExp,
      floatNaN: float.floatNaN,
      floatTime: timestamp.floatTime,
      int: int.int,
      intHex: int.intHex,
      intOct: int.intOct,
      intTime: timestamp.intTime,
      map: map.map,
      merge: merge.merge,
      null: _null.nullTag,
      omap: omap.omap,
      pairs: pairs.pairs,
      seq: seq.seq,
      set: set.set,
      timestamp: timestamp.timestamp
    };
    var coreKnownTags = {
      "tag:yaml.org,2002:binary": binary.binary,
      "tag:yaml.org,2002:merge": merge.merge,
      "tag:yaml.org,2002:omap": omap.omap,
      "tag:yaml.org,2002:pairs": pairs.pairs,
      "tag:yaml.org,2002:set": set.set,
      "tag:yaml.org,2002:timestamp": timestamp.timestamp
    };
    function getTags(customTags, schemaName, addMergeTag) {
      const schemaTags = schemas.get(schemaName);
      if (schemaTags && !customTags) {
        return addMergeTag && !schemaTags.includes(merge.merge) ? schemaTags.concat(merge.merge) : schemaTags.slice();
      }
      let tags = schemaTags;
      if (!tags) {
        if (Array.isArray(customTags))
          tags = [];
        else {
          const keys = Array.from(schemas.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
        }
      }
      if (Array.isArray(customTags)) {
        for (const tag of customTags)
          tags = tags.concat(tag);
      } else if (typeof customTags === "function") {
        tags = customTags(tags.slice());
      }
      if (addMergeTag)
        tags = tags.concat(merge.merge);
      return tags.reduce((tags2, tag) => {
        const tagObj = typeof tag === "string" ? tagsByName[tag] : tag;
        if (!tagObj) {
          const tagName = JSON.stringify(tag);
          const keys = Object.keys(tagsByName).map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
        }
        if (!tags2.includes(tagObj))
          tags2.push(tagObj);
        return tags2;
      }, []);
    }
    exports.coreKnownTags = coreKnownTags;
    exports.getTags = getTags;
  }
});

// node_modules/yaml/dist/schema/Schema.js
var require_Schema = __commonJS({
  "node_modules/yaml/dist/schema/Schema.js"(exports) {
    "use strict";
    var identity = require_identity();
    var map = require_map();
    var seq = require_seq();
    var string = require_string();
    var tags = require_tags();
    var sortMapEntriesByKey = (a2, b) => a2.key < b.key ? -1 : a2.key > b.key ? 1 : 0;
    var Schema = class _Schema {
      constructor({ compat, customTags, merge, resolveKnownTags, schema, sortMapEntries, toStringDefaults }) {
        this.compat = Array.isArray(compat) ? tags.getTags(compat, "compat") : compat ? tags.getTags(null, compat) : null;
        this.name = typeof schema === "string" && schema || "core";
        this.knownTags = resolveKnownTags ? tags.coreKnownTags : {};
        this.tags = tags.getTags(customTags, this.name, merge);
        this.toStringOptions = toStringDefaults ?? null;
        Object.defineProperty(this, identity.MAP, { value: map.map });
        Object.defineProperty(this, identity.SCALAR, { value: string.string });
        Object.defineProperty(this, identity.SEQ, { value: seq.seq });
        this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
      }
      clone() {
        const copy = Object.create(_Schema.prototype, Object.getOwnPropertyDescriptors(this));
        copy.tags = this.tags.slice();
        return copy;
      }
    };
    exports.Schema = Schema;
  }
});

// node_modules/yaml/dist/stringify/stringifyDocument.js
var require_stringifyDocument = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyDocument.js"(exports) {
    "use strict";
    var identity = require_identity();
    var stringify6 = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyDocument(doc, options) {
      const lines = [];
      let hasDirectives = options.directives === true;
      if (options.directives !== false && doc.directives) {
        const dir = doc.directives.toString(doc);
        if (dir) {
          lines.push(dir);
          hasDirectives = true;
        } else if (doc.directives.docStart)
          hasDirectives = true;
      }
      if (hasDirectives)
        lines.push("---");
      const ctx = stringify6.createStringifyContext(doc, options);
      const { commentString } = ctx.options;
      if (doc.commentBefore) {
        if (lines.length !== 1)
          lines.unshift("");
        const cs = commentString(doc.commentBefore);
        lines.unshift(stringifyComment.indentComment(cs, ""));
      }
      let chompKeep = false;
      let contentComment = null;
      if (doc.contents) {
        if (identity.isNode(doc.contents)) {
          if (doc.contents.spaceBefore && hasDirectives)
            lines.push("");
          if (doc.contents.commentBefore) {
            const cs = commentString(doc.contents.commentBefore);
            lines.push(stringifyComment.indentComment(cs, ""));
          }
          ctx.forceBlockIndent = !!doc.comment;
          contentComment = doc.contents.comment;
        }
        const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
        let body = stringify6.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
        if (contentComment)
          body += stringifyComment.lineComment(body, "", commentString(contentComment));
        if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") {
          lines[lines.length - 1] = `--- ${body}`;
        } else
          lines.push(body);
      } else {
        lines.push(stringify6.stringify(doc.contents, ctx));
      }
      if (doc.directives?.docEnd) {
        if (doc.comment) {
          const cs = commentString(doc.comment);
          if (cs.includes("\n")) {
            lines.push("...");
            lines.push(stringifyComment.indentComment(cs, ""));
          } else {
            lines.push(`... ${cs}`);
          }
        } else {
          lines.push("...");
        }
      } else {
        let dc = doc.comment;
        if (dc && chompKeep)
          dc = dc.replace(/^\n+/, "");
        if (dc) {
          if ((!chompKeep || contentComment) && lines[lines.length - 1] !== "")
            lines.push("");
          lines.push(stringifyComment.indentComment(commentString(dc), ""));
        }
      }
      return lines.join("\n") + "\n";
    }
    exports.stringifyDocument = stringifyDocument;
  }
});

// node_modules/yaml/dist/doc/Document.js
var require_Document = __commonJS({
  "node_modules/yaml/dist/doc/Document.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var toJS = require_toJS();
    var Schema = require_Schema();
    var stringifyDocument = require_stringifyDocument();
    var anchors = require_anchors();
    var applyReviver = require_applyReviver();
    var createNode = require_createNode();
    var directives = require_directives();
    var Document = class _Document {
      constructor(value, replacer, options) {
        this.commentBefore = null;
        this.comment = null;
        this.errors = [];
        this.warnings = [];
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.DOC });
        let _replacer = null;
        if (typeof replacer === "function" || Array.isArray(replacer)) {
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const opt = Object.assign({
          intAsBigInt: false,
          keepSourceTokens: false,
          logLevel: "warn",
          prettyErrors: true,
          strict: true,
          stringKeys: false,
          uniqueKeys: true,
          version: "1.2"
        }, options);
        this.options = opt;
        let { version } = opt;
        if (options?._directives) {
          this.directives = options._directives.atDocument();
          if (this.directives.yaml.explicit)
            version = this.directives.yaml.version;
        } else
          this.directives = new directives.Directives({ version });
        this.setSchema(version, options);
        this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
      }
      /**
       * Create a deep copy of this Document and its contents.
       *
       * Custom Node values that inherit from `Object` still refer to their original instances.
       */
      clone() {
        const copy = Object.create(_Document.prototype, {
          [identity.NODE_TYPE]: { value: identity.DOC }
        });
        copy.commentBefore = this.commentBefore;
        copy.comment = this.comment;
        copy.errors = this.errors.slice();
        copy.warnings = this.warnings.slice();
        copy.options = Object.assign({}, this.options);
        if (this.directives)
          copy.directives = this.directives.clone();
        copy.schema = this.schema.clone();
        copy.contents = identity.isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** Adds a value to the document. */
      add(value) {
        if (assertCollection(this.contents))
          this.contents.add(value);
      }
      /** Adds a value to the document. */
      addIn(path27, value) {
        if (assertCollection(this.contents))
          this.contents.addIn(path27, value);
      }
      /**
       * Create a new `Alias` node, ensuring that the target `node` has the required anchor.
       *
       * If `node` already has an anchor, `name` is ignored.
       * Otherwise, the `node.anchor` value will be set to `name`,
       * or if an anchor with that name is already present in the document,
       * `name` will be used as a prefix for a new unique anchor.
       * If `name` is undefined, the generated anchor will use 'a' as a prefix.
       */
      createAlias(node, name) {
        if (!node.anchor) {
          const prev = anchors.anchorNames(this);
          node.anchor = // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          !name || prev.has(name) ? anchors.findNewAnchor(name || "a", prev) : name;
        }
        return new Alias.Alias(node.anchor);
      }
      createNode(value, replacer, options) {
        let _replacer = void 0;
        if (typeof replacer === "function") {
          value = replacer.call({ "": value }, "", value);
          _replacer = replacer;
        } else if (Array.isArray(replacer)) {
          const keyToStr = (v) => typeof v === "number" || v instanceof String || v instanceof Number;
          const asStr = replacer.filter(keyToStr).map(String);
          if (asStr.length > 0)
            replacer = replacer.concat(asStr);
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {};
        const { onAnchor, setAnchors, sourceObjects } = anchors.createNodeAnchors(
          this,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          anchorPrefix || "a"
        );
        const ctx = {
          aliasDuplicateObjects: aliasDuplicateObjects ?? true,
          keepUndefined: keepUndefined ?? false,
          onAnchor,
          onTagObj,
          replacer: _replacer,
          schema: this.schema,
          sourceObjects
        };
        const node = createNode.createNode(value, tag, ctx);
        if (flow && identity.isCollection(node))
          node.flow = true;
        setAnchors();
        return node;
      }
      /**
       * Convert a key and a value into a `Pair` using the current schema,
       * recursively wrapping all values as `Scalar` or `Collection` nodes.
       */
      createPair(key, value, options = {}) {
        const k = this.createNode(key, null, options);
        const v = this.createNode(value, null, options);
        return new Pair.Pair(k, v);
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        return assertCollection(this.contents) ? this.contents.delete(key) : false;
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path27) {
        if (Collection.isEmptyPath(path27)) {
          if (this.contents == null)
            return false;
          this.contents = null;
          return true;
        }
        return assertCollection(this.contents) ? this.contents.deleteIn(path27) : false;
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      get(key, keepScalar) {
        return identity.isCollection(this.contents) ? this.contents.get(key, keepScalar) : void 0;
      }
      /**
       * Returns item at `path`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path27, keepScalar) {
        if (Collection.isEmptyPath(path27))
          return !keepScalar && identity.isScalar(this.contents) ? this.contents.value : this.contents;
        return identity.isCollection(this.contents) ? this.contents.getIn(path27, keepScalar) : void 0;
      }
      /**
       * Checks if the document includes a value with the key `key`.
       */
      has(key) {
        return identity.isCollection(this.contents) ? this.contents.has(key) : false;
      }
      /**
       * Checks if the document includes a value at `path`.
       */
      hasIn(path27) {
        if (Collection.isEmptyPath(path27))
          return this.contents !== void 0;
        return identity.isCollection(this.contents) ? this.contents.hasIn(path27) : false;
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      set(key, value) {
        if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, [key], value);
        } else if (assertCollection(this.contents)) {
          this.contents.set(key, value);
        }
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path27, value) {
        if (Collection.isEmptyPath(path27)) {
          this.contents = value;
        } else if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, Array.from(path27), value);
        } else if (assertCollection(this.contents)) {
          this.contents.setIn(path27, value);
        }
      }
      /**
       * Change the YAML version and schema used by the document.
       * A `null` version disables support for directives, explicit tags, anchors, and aliases.
       * It also requires the `schema` option to be given as a `Schema` instance value.
       *
       * Overrides all previously set schema options.
       */
      setSchema(version, options = {}) {
        if (typeof version === "number")
          version = String(version);
        let opt;
        switch (version) {
          case "1.1":
            if (this.directives)
              this.directives.yaml.version = "1.1";
            else
              this.directives = new directives.Directives({ version: "1.1" });
            opt = { resolveKnownTags: false, schema: "yaml-1.1" };
            break;
          case "1.2":
          case "next":
            if (this.directives)
              this.directives.yaml.version = version;
            else
              this.directives = new directives.Directives({ version });
            opt = { resolveKnownTags: true, schema: "core" };
            break;
          case null:
            if (this.directives)
              delete this.directives;
            opt = null;
            break;
          default: {
            const sv = JSON.stringify(version);
            throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
          }
        }
        if (options.schema instanceof Object)
          this.schema = options.schema;
        else if (opt)
          this.schema = new Schema.Schema(Object.assign(opt, options));
        else
          throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
      }
      // json & jsonArg are only used from toJSON()
      toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc: this,
          keep: !json,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this.contents, jsonArg ?? "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
      /**
       * A JSON representation of the document `contents`.
       *
       * @param jsonArg Used by `JSON.stringify` to indicate the array index or
       *   property name.
       */
      toJSON(jsonArg, onAnchor) {
        return this.toJS({ json: true, jsonArg, mapAsMap: false, onAnchor });
      }
      /** A YAML representation of the document. */
      toString(options = {}) {
        if (this.errors.length > 0)
          throw new Error("Document with errors cannot be stringified");
        if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
          const s = JSON.stringify(options.indent);
          throw new Error(`"indent" option must be a positive integer, not ${s}`);
        }
        return stringifyDocument.stringifyDocument(this, options);
      }
    };
    function assertCollection(contents) {
      if (identity.isCollection(contents))
        return true;
      throw new Error("Expected a YAML collection as document contents");
    }
    exports.Document = Document;
  }
});

// node_modules/yaml/dist/errors.js
var require_errors = __commonJS({
  "node_modules/yaml/dist/errors.js"(exports) {
    "use strict";
    var YAMLError = class extends Error {
      constructor(name, pos, code, message) {
        super();
        this.name = name;
        this.code = code;
        this.message = message;
        this.pos = pos;
      }
    };
    var YAMLParseError = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLParseError", pos, code, message);
      }
    };
    var YAMLWarning = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLWarning", pos, code, message);
      }
    };
    var prettifyError = (src, lc) => (error) => {
      if (error.pos[0] === -1)
        return;
      error.linePos = error.pos.map((pos) => lc.linePos(pos));
      const { line, col } = error.linePos[0];
      error.message += ` at line ${line}, column ${col}`;
      let ci = col - 1;
      let lineStr = src.substring(lc.lineStarts[line - 1], lc.lineStarts[line]).replace(/[\n\r]+$/, "");
      if (ci >= 60 && lineStr.length > 80) {
        const trimStart = Math.min(ci - 39, lineStr.length - 79);
        lineStr = "\u2026" + lineStr.substring(trimStart);
        ci -= trimStart - 1;
      }
      if (lineStr.length > 80)
        lineStr = lineStr.substring(0, 79) + "\u2026";
      if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
        let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
        if (prev.length > 80)
          prev = prev.substring(0, 79) + "\u2026\n";
        lineStr = prev + lineStr;
      }
      if (/[^ ]/.test(lineStr)) {
        let count = 1;
        const end = error.linePos[1];
        if (end?.line === line && end.col > col) {
          count = Math.max(1, Math.min(end.col - col, 80 - ci));
        }
        const pointer = " ".repeat(ci) + "^".repeat(count);
        error.message += `:

${lineStr}
${pointer}
`;
      }
    };
    exports.YAMLError = YAMLError;
    exports.YAMLParseError = YAMLParseError;
    exports.YAMLWarning = YAMLWarning;
    exports.prettifyError = prettifyError;
  }
});

// node_modules/yaml/dist/compose/resolve-props.js
var require_resolve_props = __commonJS({
  "node_modules/yaml/dist/compose/resolve-props.js"(exports) {
    "use strict";
    function resolveProps(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
      let spaceBefore = false;
      let atNewline = startOnNewline;
      let hasSpace = startOnNewline;
      let comment = "";
      let commentSep = "";
      let hasNewline = false;
      let reqSpace = false;
      let tab = null;
      let anchor = null;
      let tag = null;
      let newlineAfterProp = null;
      let comma = null;
      let found = null;
      let start = null;
      for (const token of tokens) {
        if (reqSpace) {
          if (token.type !== "space" && token.type !== "newline" && token.type !== "comma")
            onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
          reqSpace = false;
        }
        if (tab) {
          if (atNewline && token.type !== "comment" && token.type !== "newline") {
            onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
          }
          tab = null;
        }
        switch (token.type) {
          case "space":
            if (!flow && (indicator !== "doc-start" || next?.type !== "flow-collection") && token.source.includes("	")) {
              tab = token;
            }
            hasSpace = true;
            break;
          case "comment": {
            if (!hasSpace)
              onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
            const cb = token.source.substring(1) || " ";
            if (!comment)
              comment = cb;
            else
              comment += commentSep + cb;
            commentSep = "";
            atNewline = false;
            break;
          }
          case "newline":
            if (atNewline) {
              if (comment)
                comment += token.source;
              else if (!found || indicator !== "seq-item-ind")
                spaceBefore = true;
            } else
              commentSep += token.source;
            atNewline = true;
            hasNewline = true;
            if (anchor || tag)
              newlineAfterProp = token;
            hasSpace = true;
            break;
          case "anchor":
            if (anchor)
              onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
            if (token.source.endsWith(":"))
              onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
            anchor = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          case "tag": {
            if (tag)
              onError(token, "MULTIPLE_TAGS", "A node can have at most one tag");
            tag = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          }
          case indicator:
            if (anchor || tag)
              onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`);
            if (found)
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`);
            found = token;
            atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind";
            hasSpace = false;
            break;
          case "comma":
            if (flow) {
              if (comma)
                onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`);
              comma = token;
              atNewline = false;
              hasSpace = false;
              break;
            }
          // else fallthrough
          default:
            onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`);
            atNewline = false;
            hasSpace = false;
        }
      }
      const last = tokens[tokens.length - 1];
      const end = last ? last.offset + last.source.length : offset;
      if (reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "")) {
        onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
      }
      if (tab && (atNewline && tab.indent <= parentIndent || next?.type === "block-map" || next?.type === "block-seq"))
        onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
      return {
        comma,
        found,
        spaceBefore,
        comment,
        hasNewline,
        anchor,
        tag,
        newlineAfterProp,
        end,
        start: start ?? end
      };
    }
    exports.resolveProps = resolveProps;
  }
});

// node_modules/yaml/dist/compose/util-contains-newline.js
var require_util_contains_newline = __commonJS({
  "node_modules/yaml/dist/compose/util-contains-newline.js"(exports) {
    "use strict";
    function containsNewline(key) {
      if (!key)
        return null;
      switch (key.type) {
        case "alias":
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          if (key.source.includes("\n"))
            return true;
          if (key.end) {
            for (const st of key.end)
              if (st.type === "newline")
                return true;
          }
          return false;
        case "flow-collection":
          for (const it of key.items) {
            for (const st of it.start)
              if (st.type === "newline")
                return true;
            if (it.sep) {
              for (const st of it.sep)
                if (st.type === "newline")
                  return true;
            }
            if (containsNewline(it.key) || containsNewline(it.value))
              return true;
          }
          return false;
        default:
          return true;
      }
    }
    exports.containsNewline = containsNewline;
  }
});

// node_modules/yaml/dist/compose/util-flow-indent-check.js
var require_util_flow_indent_check = __commonJS({
  "node_modules/yaml/dist/compose/util-flow-indent-check.js"(exports) {
    "use strict";
    var utilContainsNewline = require_util_contains_newline();
    function flowIndentCheck(indent, fc, onError) {
      if (fc?.type === "flow-collection") {
        const end = fc.end[0];
        if (end.indent === indent && (end.source === "]" || end.source === "}") && utilContainsNewline.containsNewline(fc)) {
          const msg = "Flow end indicator should be more indented than parent";
          onError(end, "BAD_INDENT", msg, true);
        }
      }
    }
    exports.flowIndentCheck = flowIndentCheck;
  }
});

// node_modules/yaml/dist/compose/util-map-includes.js
var require_util_map_includes = __commonJS({
  "node_modules/yaml/dist/compose/util-map-includes.js"(exports) {
    "use strict";
    var identity = require_identity();
    function mapIncludes(ctx, items, search) {
      const { uniqueKeys } = ctx.options;
      if (uniqueKeys === false)
        return false;
      const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a2, b) => a2 === b || identity.isScalar(a2) && identity.isScalar(b) && a2.value === b.value;
      return items.some((pair) => isEqual(pair.key, search));
    }
    exports.mapIncludes = mapIncludes;
  }
});

// node_modules/yaml/dist/compose/resolve-block-map.js
var require_resolve_block_map = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-map.js"(exports) {
    "use strict";
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    var utilMapIncludes = require_util_map_includes();
    var startColMsg = "All mapping items must start at the same column";
    function resolveBlockMap({ composeNode, composeEmptyNode }, ctx, bm, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLMap.YAMLMap;
      const map = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      let offset = bm.offset;
      let commentEnd = null;
      for (const collItem of bm.items) {
        const { start, key, sep, value } = collItem;
        const keyProps = resolveProps.resolveProps(start, {
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: bm.indent,
          startOnNewline: true
        });
        const implicitKey = !keyProps.found;
        if (implicitKey) {
          if (key) {
            if (key.type === "block-seq")
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key");
            else if ("indent" in key && key.indent !== bm.indent)
              onError(offset, "BAD_INDENT", startColMsg);
          }
          if (!keyProps.anchor && !keyProps.tag && !sep) {
            commentEnd = keyProps.end;
            if (keyProps.comment) {
              if (map.comment)
                map.comment += "\n" + keyProps.comment;
              else
                map.comment = keyProps.comment;
            }
            continue;
          }
          if (keyProps.newlineAfterProp || utilContainsNewline.containsNewline(key)) {
            onError(key ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
          }
        } else if (keyProps.found?.indent !== bm.indent) {
          onError(offset, "BAD_INDENT", startColMsg);
        }
        ctx.atKey = true;
        const keyStart = keyProps.end;
        const keyNode = key ? composeNode(ctx, key, keyProps, onError) : composeEmptyNode(ctx, keyStart, start, null, keyProps, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bm.indent, key, onError);
        ctx.atKey = false;
        if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
          onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
        const valueProps = resolveProps.resolveProps(sep ?? [], {
          indicator: "map-value-ind",
          next: value,
          offset: keyNode.range[2],
          onError,
          parentIndent: bm.indent,
          startOnNewline: !key || key.type === "block-scalar"
        });
        offset = valueProps.end;
        if (valueProps.found) {
          if (implicitKey) {
            if (value?.type === "block-map" && !valueProps.hasNewline)
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings");
            if (ctx.options.strict && keyProps.start < valueProps.found.offset - 1024)
              onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key");
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : composeEmptyNode(ctx, offset, sep, null, valueProps, onError);
          if (ctx.schema.compat)
            utilFlowIndentCheck.flowIndentCheck(bm.indent, value, onError);
          offset = valueNode.range[2];
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        } else {
          if (implicitKey)
            onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
          if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        }
      }
      if (commentEnd && commentEnd < offset)
        onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
      map.range = [bm.offset, offset, commentEnd ?? offset];
      return map;
    }
    exports.resolveBlockMap = resolveBlockMap;
  }
});

// node_modules/yaml/dist/compose/resolve-block-seq.js
var require_resolve_block_seq = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-seq.js"(exports) {
    "use strict";
    var YAMLSeq = require_YAMLSeq();
    var resolveProps = require_resolve_props();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    function resolveBlockSeq({ composeNode, composeEmptyNode }, ctx, bs, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLSeq.YAMLSeq;
      const seq = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = bs.offset;
      let commentEnd = null;
      for (const { start, value } of bs.items) {
        const props = resolveProps.resolveProps(start, {
          indicator: "seq-item-ind",
          next: value,
          offset,
          onError,
          parentIndent: bs.indent,
          startOnNewline: true
        });
        if (!props.found) {
          if (props.anchor || props.tag || value) {
            if (value?.type === "block-seq")
              onError(props.end, "BAD_INDENT", "All sequence items must start at the same column");
            else
              onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
          } else {
            commentEnd = props.end;
            if (props.comment)
              seq.comment = props.comment;
            continue;
          }
        }
        const node = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bs.indent, value, onError);
        offset = node.range[2];
        seq.items.push(node);
      }
      seq.range = [bs.offset, offset, commentEnd ?? offset];
      return seq;
    }
    exports.resolveBlockSeq = resolveBlockSeq;
  }
});

// node_modules/yaml/dist/compose/resolve-end.js
var require_resolve_end = __commonJS({
  "node_modules/yaml/dist/compose/resolve-end.js"(exports) {
    "use strict";
    function resolveEnd(end, offset, reqSpace, onError) {
      let comment = "";
      if (end) {
        let hasSpace = false;
        let sep = "";
        for (const token of end) {
          const { source, type } = token;
          switch (type) {
            case "space":
              hasSpace = true;
              break;
            case "comment": {
              if (reqSpace && !hasSpace)
                onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
              const cb = source.substring(1) || " ";
              if (!comment)
                comment = cb;
              else
                comment += sep + cb;
              sep = "";
              break;
            }
            case "newline":
              if (comment)
                sep += source;
              hasSpace = true;
              break;
            default:
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
          }
          offset += source.length;
        }
      }
      return { comment, offset };
    }
    exports.resolveEnd = resolveEnd;
  }
});

// node_modules/yaml/dist/compose/resolve-flow-collection.js
var require_resolve_flow_collection = __commonJS({
  "node_modules/yaml/dist/compose/resolve-flow-collection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilMapIncludes = require_util_map_includes();
    var blockMsg = "Block collections are not allowed within flow collections";
    var isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
    function resolveFlowCollection({ composeNode, composeEmptyNode }, ctx, fc, onError, tag) {
      const isMap = fc.start.source === "{";
      const fcName = isMap ? "flow map" : "flow sequence";
      const NodeClass = tag?.nodeClass ?? (isMap ? YAMLMap.YAMLMap : YAMLSeq.YAMLSeq);
      const coll = new NodeClass(ctx.schema);
      coll.flow = true;
      const atRoot = ctx.atRoot;
      if (atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = fc.offset + fc.start.source.length;
      for (let i2 = 0; i2 < fc.items.length; ++i2) {
        const collItem = fc.items[i2];
        const { start, key, sep, value } = collItem;
        const props = resolveProps.resolveProps(start, {
          flow: fcName,
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: fc.indent,
          startOnNewline: false
        });
        if (!props.found) {
          if (!props.anchor && !props.tag && !sep && !value) {
            if (i2 === 0 && props.comma)
              onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
            else if (i2 < fc.items.length - 1)
              onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`);
            if (props.comment) {
              if (coll.comment)
                coll.comment += "\n" + props.comment;
              else
                coll.comment = props.comment;
            }
            offset = props.end;
            continue;
          }
          if (!isMap && ctx.options.strict && utilContainsNewline.containsNewline(key))
            onError(
              key,
              // checked by containsNewline()
              "MULTILINE_IMPLICIT_KEY",
              "Implicit keys of flow sequence pairs need to be on a single line"
            );
        }
        if (i2 === 0) {
          if (props.comma)
            onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
        } else {
          if (!props.comma)
            onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`);
          if (props.comment) {
            let prevItemComment = "";
            loop: for (const st of start) {
              switch (st.type) {
                case "comma":
                case "space":
                  break;
                case "comment":
                  prevItemComment = st.source.substring(1);
                  break loop;
                default:
                  break loop;
              }
            }
            if (prevItemComment) {
              let prev = coll.items[coll.items.length - 1];
              if (identity.isPair(prev))
                prev = prev.value ?? prev.key;
              if (prev.comment)
                prev.comment += "\n" + prevItemComment;
              else
                prev.comment = prevItemComment;
              props.comment = props.comment.substring(prevItemComment.length + 1);
            }
          }
        }
        if (!isMap && !sep && !props.found) {
          const valueNode = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, sep, null, props, onError);
          coll.items.push(valueNode);
          offset = valueNode.range[2];
          if (isBlock(value))
            onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
        } else {
          ctx.atKey = true;
          const keyStart = props.end;
          const keyNode = key ? composeNode(ctx, key, props, onError) : composeEmptyNode(ctx, keyStart, start, null, props, onError);
          if (isBlock(key))
            onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
          ctx.atKey = false;
          const valueProps = resolveProps.resolveProps(sep ?? [], {
            flow: fcName,
            indicator: "map-value-ind",
            next: value,
            offset: keyNode.range[2],
            onError,
            parentIndent: fc.indent,
            startOnNewline: false
          });
          if (valueProps.found) {
            if (!isMap && !props.found && ctx.options.strict) {
              if (sep)
                for (const st of sep) {
                  if (st === valueProps.found)
                    break;
                  if (st.type === "newline") {
                    onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
                    break;
                  }
                }
              if (props.start < valueProps.found.offset - 1024)
                onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
            }
          } else if (value) {
            if ("source" in value && value.source?.[0] === ":")
              onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`);
            else
              onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`);
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode(ctx, valueProps.end, sep, null, valueProps, onError) : null;
          if (valueNode) {
            if (isBlock(value))
              onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
          } else if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          if (isMap) {
            const map = coll;
            if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
              onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
            map.items.push(pair);
          } else {
            const map = new YAMLMap.YAMLMap(ctx.schema);
            map.flow = true;
            map.items.push(pair);
            const endRange = (valueNode ?? keyNode).range;
            map.range = [keyNode.range[0], endRange[1], endRange[2]];
            coll.items.push(map);
          }
          offset = valueNode ? valueNode.range[2] : valueProps.end;
        }
      }
      const expectedEnd = isMap ? "}" : "]";
      const [ce, ...ee] = fc.end;
      let cePos = offset;
      if (ce?.source === expectedEnd)
        cePos = ce.offset + ce.source.length;
      else {
        const name = fcName[0].toUpperCase() + fcName.substring(1);
        const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
        onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
        if (ce && ce.source.length !== 1)
          ee.unshift(ce);
      }
      if (ee.length > 0) {
        const end = resolveEnd.resolveEnd(ee, cePos, ctx.options.strict, onError);
        if (end.comment) {
          if (coll.comment)
            coll.comment += "\n" + end.comment;
          else
            coll.comment = end.comment;
        }
        coll.range = [fc.offset, cePos, end.offset];
      } else {
        coll.range = [fc.offset, cePos, cePos];
      }
      return coll;
    }
    exports.resolveFlowCollection = resolveFlowCollection;
  }
});

// node_modules/yaml/dist/compose/compose-collection.js
var require_compose_collection = __commonJS({
  "node_modules/yaml/dist/compose/compose-collection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveBlockMap = require_resolve_block_map();
    var resolveBlockSeq = require_resolve_block_seq();
    var resolveFlowCollection = require_resolve_flow_collection();
    function resolveCollection(CN, ctx, token, onError, tagName, tag) {
      const coll = token.type === "block-map" ? resolveBlockMap.resolveBlockMap(CN, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq.resolveBlockSeq(CN, ctx, token, onError, tag) : resolveFlowCollection.resolveFlowCollection(CN, ctx, token, onError, tag);
      const Coll = coll.constructor;
      if (tagName === "!" || tagName === Coll.tagName) {
        coll.tag = Coll.tagName;
        return coll;
      }
      if (tagName)
        coll.tag = tagName;
      return coll;
    }
    function composeCollection(CN, ctx, token, props, onError) {
      const tagToken = props.tag;
      const tagName = !tagToken ? null : ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg));
      if (token.type === "block-seq") {
        const { anchor, newlineAfterProp: nl } = props;
        const lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor ?? tagToken;
        if (lastProp && (!nl || nl.offset < lastProp.offset)) {
          const message = "Missing newline after block sequence props";
          onError(lastProp, "MISSING_CHAR", message);
        }
      }
      const expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
      if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.YAMLSeq.tagName && expType === "seq") {
        return resolveCollection(CN, ctx, token, onError, tagName);
      }
      let tag = ctx.schema.tags.find((t2) => t2.tag === tagName && t2.collection === expType);
      if (!tag) {
        const kt = ctx.schema.knownTags[tagName];
        if (kt?.collection === expType) {
          ctx.schema.tags.push(Object.assign({}, kt, { default: false }));
          tag = kt;
        } else {
          if (kt) {
            onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, true);
          } else {
            onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, true);
          }
          return resolveCollection(CN, ctx, token, onError, tagName);
        }
      }
      const coll = resolveCollection(CN, ctx, token, onError, tagName, tag);
      const res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll;
      const node = identity.isNode(res) ? res : new Scalar.Scalar(res);
      node.range = coll.range;
      node.tag = tagName;
      if (tag?.format)
        node.format = tag.format;
      return node;
    }
    exports.composeCollection = composeCollection;
  }
});

// node_modules/yaml/dist/compose/resolve-block-scalar.js
var require_resolve_block_scalar = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function resolveBlockScalar(ctx, scalar, onError) {
      const start = scalar.offset;
      const header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
      if (!header)
        return { value: "", type: null, comment: "", range: [start, start, start] };
      const type = header.mode === ">" ? Scalar.Scalar.BLOCK_FOLDED : Scalar.Scalar.BLOCK_LITERAL;
      const lines = scalar.source ? splitLines(scalar.source) : [];
      let chompStart = lines.length;
      for (let i2 = lines.length - 1; i2 >= 0; --i2) {
        const content = lines[i2][1];
        if (content === "" || content === "\r")
          chompStart = i2;
        else
          break;
      }
      if (chompStart === 0) {
        const value2 = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "";
        let end2 = start + header.length;
        if (scalar.source)
          end2 += scalar.source.length;
        return { value: value2, type, comment: header.comment, range: [start, end2, end2] };
      }
      let trimIndent = scalar.indent + header.indent;
      let offset = scalar.offset + header.length;
      let contentStart = 0;
      for (let i2 = 0; i2 < chompStart; ++i2) {
        const [indent, content] = lines[i2];
        if (content === "" || content === "\r") {
          if (header.indent === 0 && indent.length > trimIndent)
            trimIndent = indent.length;
        } else {
          if (indent.length < trimIndent) {
            const message = "Block scalars with more-indented leading empty lines must use an explicit indentation indicator";
            onError(offset + indent.length, "MISSING_CHAR", message);
          }
          if (header.indent === 0)
            trimIndent = indent.length;
          contentStart = i2;
          if (trimIndent === 0 && !ctx.atRoot) {
            const message = "Block scalar values in collections must be indented";
            onError(offset, "BAD_INDENT", message);
          }
          break;
        }
        offset += indent.length + content.length + 1;
      }
      for (let i2 = lines.length - 1; i2 >= chompStart; --i2) {
        if (lines[i2][0].length > trimIndent)
          chompStart = i2 + 1;
      }
      let value = "";
      let sep = "";
      let prevMoreIndented = false;
      for (let i2 = 0; i2 < contentStart; ++i2)
        value += lines[i2][0].slice(trimIndent) + "\n";
      for (let i2 = contentStart; i2 < chompStart; ++i2) {
        let [indent, content] = lines[i2];
        offset += indent.length + content.length + 1;
        const crlf = content[content.length - 1] === "\r";
        if (crlf)
          content = content.slice(0, -1);
        if (content && indent.length < trimIndent) {
          const src = header.indent ? "explicit indentation indicator" : "first line";
          const message = `Block scalar lines must not be less indented than their ${src}`;
          onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message);
          indent = "";
        }
        if (type === Scalar.Scalar.BLOCK_LITERAL) {
          value += sep + indent.slice(trimIndent) + content;
          sep = "\n";
        } else if (indent.length > trimIndent || content[0] === "	") {
          if (sep === " ")
            sep = "\n";
          else if (!prevMoreIndented && sep === "\n")
            sep = "\n\n";
          value += sep + indent.slice(trimIndent) + content;
          sep = "\n";
          prevMoreIndented = true;
        } else if (content === "") {
          if (sep === "\n")
            value += "\n";
          else
            sep = "\n";
        } else {
          value += sep + content;
          sep = " ";
          prevMoreIndented = false;
        }
      }
      switch (header.chomp) {
        case "-":
          break;
        case "+":
          for (let i2 = chompStart; i2 < lines.length; ++i2)
            value += "\n" + lines[i2][0].slice(trimIndent);
          if (value[value.length - 1] !== "\n")
            value += "\n";
          break;
        default:
          value += "\n";
      }
      const end = start + header.length + scalar.source.length;
      return { value, type, comment: header.comment, range: [start, end, end] };
    }
    function parseBlockScalarHeader({ offset, props }, strict, onError) {
      if (props[0].type !== "block-scalar-header") {
        onError(props[0], "IMPOSSIBLE", "Block scalar header not found");
        return null;
      }
      const { source } = props[0];
      const mode = source[0];
      let indent = 0;
      let chomp = "";
      let error = -1;
      for (let i2 = 1; i2 < source.length; ++i2) {
        const ch = source[i2];
        if (!chomp && (ch === "-" || ch === "+"))
          chomp = ch;
        else {
          const n3 = Number(ch);
          if (!indent && n3)
            indent = n3;
          else if (error === -1)
            error = offset + i2;
        }
      }
      if (error !== -1)
        onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
      let hasSpace = false;
      let comment = "";
      let length = source.length;
      for (let i2 = 1; i2 < props.length; ++i2) {
        const token = props[i2];
        switch (token.type) {
          case "space":
            hasSpace = true;
          // fallthrough
          case "newline":
            length += token.source.length;
            break;
          case "comment":
            if (strict && !hasSpace) {
              const message = "Comments must be separated from other tokens by white space characters";
              onError(token, "MISSING_CHAR", message);
            }
            length += token.source.length;
            comment = token.source.substring(1);
            break;
          case "error":
            onError(token, "UNEXPECTED_TOKEN", token.message);
            length += token.source.length;
            break;
          /* istanbul ignore next should not happen */
          default: {
            const message = `Unexpected token in block scalar header: ${token.type}`;
            onError(token, "UNEXPECTED_TOKEN", message);
            const ts = token.source;
            if (ts && typeof ts === "string")
              length += ts.length;
          }
        }
      }
      return { mode, indent, chomp, comment, length };
    }
    function splitLines(source) {
      const split = source.split(/\n( *)/);
      const first = split[0];
      const m2 = first.match(/^( *)/);
      const line0 = m2?.[1] ? [m2[1], first.slice(m2[1].length)] : ["", first];
      const lines = [line0];
      for (let i2 = 1; i2 < split.length; i2 += 2)
        lines.push([split[i2], split[i2 + 1]]);
      return lines;
    }
    exports.resolveBlockScalar = resolveBlockScalar;
  }
});

// node_modules/yaml/dist/compose/resolve-flow-scalar.js
var require_resolve_flow_scalar = __commonJS({
  "node_modules/yaml/dist/compose/resolve-flow-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var resolveEnd = require_resolve_end();
    function resolveFlowScalar(scalar, strict, onError) {
      const { offset, type, source, end } = scalar;
      let _type;
      let value;
      const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
      switch (type) {
        case "scalar":
          _type = Scalar.Scalar.PLAIN;
          value = plainValue(source, _onError);
          break;
        case "single-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_SINGLE;
          value = singleQuotedValue(source, _onError);
          break;
        case "double-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_DOUBLE;
          value = doubleQuotedValue(source, _onError);
          break;
        /* istanbul ignore next should not happen */
        default:
          onError(scalar, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
          return {
            value: "",
            type: null,
            comment: "",
            range: [offset, offset + source.length, offset + source.length]
          };
      }
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, strict, onError);
      return {
        value,
        type: _type,
        comment: re.comment,
        range: [offset, valueEnd, re.offset]
      };
    }
    function plainValue(source, onError) {
      let badChar = "";
      switch (source[0]) {
        /* istanbul ignore next should not happen */
        case "	":
          badChar = "a tab character";
          break;
        case ",":
          badChar = "flow indicator character ,";
          break;
        case "%":
          badChar = "directive indicator character %";
          break;
        case "|":
        case ">": {
          badChar = `block scalar indicator ${source[0]}`;
          break;
        }
        case "@":
        case "`": {
          badChar = `reserved character ${source[0]}`;
          break;
        }
      }
      if (badChar)
        onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`);
      return unfoldLines(source);
    }
    function singleQuotedValue(source, onError) {
      if (source[source.length - 1] !== "'" || source.length === 1)
        onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
      return unfoldLines(source.slice(1, -1)).replace(/''/g, "'");
    }
    function unfoldLines(source) {
      const line = /(.*?)\r?\n/sy;
      let match = line.exec(source);
      if (!match)
        return source;
      let trimEnd, trimBoth;
      try {
        trimEnd = new RegExp("(?<![ 	])[ 	]+$");
        trimBoth = new RegExp("^[ 	]+|(?<![ 	])[ 	]+$", "g");
      } catch {
        trimEnd = /[ \t]+$/;
        trimBoth = /^[ \t]+|[ \t]+$/g;
      }
      let res = match[1].replace(trimEnd, "");
      let sep = " ";
      let pos = line.lastIndex;
      while (match = line.exec(source)) {
        const lm = match[1].replace(trimBoth, "");
        if (lm === "") {
          if (sep === "\n")
            res += sep;
          else
            sep = "\n";
        } else {
          res += sep + lm;
          sep = " ";
        }
        pos = line.lastIndex;
      }
      const last = /[ \t]*(.*)/sy;
      last.lastIndex = pos;
      match = last.exec(source);
      return res + sep + (match?.[1] ?? "");
    }
    function doubleQuotedValue(source, onError) {
      let res = "";
      for (let i2 = 1; i2 < source.length - 1; ++i2) {
        const ch = source[i2];
        if (ch === "\r" && source[i2 + 1] === "\n")
          continue;
        if (ch === "\n") {
          const { fold, offset } = foldNewline(source, i2);
          res += fold;
          i2 = offset;
        } else if (ch === "\\") {
          let next = source[++i2];
          const cc = escapeCodes[next];
          if (cc)
            res += cc;
          else if (next === "\n") {
            next = source[i2 + 1];
            while (next === " " || next === "	")
              next = source[++i2 + 1];
          } else if (next === "\r" && source[i2 + 1] === "\n") {
            next = source[++i2 + 1];
            while (next === " " || next === "	")
              next = source[++i2 + 1];
          } else if (next === "x" || next === "u" || next === "U") {
            const length = next === "x" ? 2 : next === "u" ? 4 : 8;
            res += parseCharCode(source, i2 + 1, length, onError);
            i2 += length;
          } else {
            const raw = source.substr(i2 - 1, 2);
            onError(i2 - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
            res += raw;
          }
        } else if (ch === " " || ch === "	") {
          const wsStart = i2;
          let next = source[i2 + 1];
          while (next === " " || next === "	")
            next = source[++i2 + 1];
          if (next !== "\n" && !(next === "\r" && source[i2 + 2] === "\n"))
            res += i2 > wsStart ? source.slice(wsStart, i2 + 1) : ch;
        } else {
          res += ch;
        }
      }
      if (source[source.length - 1] !== '"' || source.length === 1)
        onError(source.length, "MISSING_CHAR", 'Missing closing "quote');
      return res;
    }
    function foldNewline(source, offset) {
      let fold = "";
      let ch = source[offset + 1];
      while (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
        if (ch === "\r" && source[offset + 2] !== "\n")
          break;
        if (ch === "\n")
          fold += "\n";
        offset += 1;
        ch = source[offset + 1];
      }
      if (!fold)
        fold = " ";
      return { fold, offset };
    }
    var escapeCodes = {
      "0": "\0",
      // null character
      a: "\x07",
      // bell character
      b: "\b",
      // backspace
      e: "\x1B",
      // escape character
      f: "\f",
      // form feed
      n: "\n",
      // line feed
      r: "\r",
      // carriage return
      t: "	",
      // horizontal tab
      v: "\v",
      // vertical tab
      N: "\x85",
      // Unicode next line
      _: "\xA0",
      // Unicode non-breaking space
      L: "\u2028",
      // Unicode line separator
      P: "\u2029",
      // Unicode paragraph separator
      " ": " ",
      '"': '"',
      "/": "/",
      "\\": "\\",
      "	": "	"
    };
    function parseCharCode(source, offset, length, onError) {
      const cc = source.substr(offset, length);
      const ok = cc.length === length && /^[0-9a-fA-F]+$/.test(cc);
      const code = ok ? parseInt(cc, 16) : NaN;
      try {
        return String.fromCodePoint(code);
      } catch {
        const raw = source.substr(offset - 2, length + 2);
        onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
        return raw;
      }
    }
    exports.resolveFlowScalar = resolveFlowScalar;
  }
});

// node_modules/yaml/dist/compose/compose-scalar.js
var require_compose_scalar = __commonJS({
  "node_modules/yaml/dist/compose/compose-scalar.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    function composeScalar(ctx, token, tagToken, onError) {
      const { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar.resolveBlockScalar(ctx, token, onError) : resolveFlowScalar.resolveFlowScalar(token, ctx.options.strict, onError);
      const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
      let tag;
      if (ctx.options.stringKeys && ctx.atKey) {
        tag = ctx.schema[identity.SCALAR];
      } else if (tagName)
        tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
      else if (token.type === "scalar")
        tag = findScalarTagByTest(ctx, value, token, onError);
      else
        tag = ctx.schema[identity.SCALAR];
      let scalar;
      try {
        const res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
        scalar = identity.isScalar(res) ? res : new Scalar.Scalar(res);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
        scalar = new Scalar.Scalar(value);
      }
      scalar.range = range;
      scalar.source = value;
      if (type)
        scalar.type = type;
      if (tagName)
        scalar.tag = tagName;
      if (tag.format)
        scalar.format = tag.format;
      if (comment)
        scalar.comment = comment;
      return scalar;
    }
    function findScalarTagByName(schema, value, tagName, tagToken, onError) {
      if (tagName === "!")
        return schema[identity.SCALAR];
      const matchWithTest = [];
      for (const tag of schema.tags) {
        if (!tag.collection && tag.tag === tagName) {
          if (tag.default && tag.test)
            matchWithTest.push(tag);
          else
            return tag;
        }
      }
      for (const tag of matchWithTest)
        if (tag.test?.test(value))
          return tag;
      const kt = schema.knownTags[tagName];
      if (kt && !kt.collection) {
        schema.tags.push(Object.assign({}, kt, { default: false, test: void 0 }));
        return kt;
      }
      onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
      return schema[identity.SCALAR];
    }
    function findScalarTagByTest({ atKey, directives, schema }, value, token, onError) {
      const tag = schema.tags.find((tag2) => (tag2.default === true || atKey && tag2.default === "key") && tag2.test?.test(value)) || schema[identity.SCALAR];
      if (schema.compat) {
        const compat = schema.compat.find((tag2) => tag2.default && tag2.test?.test(value)) ?? schema[identity.SCALAR];
        if (tag.tag !== compat.tag) {
          const ts = directives.tagString(tag.tag);
          const cs = directives.tagString(compat.tag);
          const msg = `Value may be parsed as either ${ts} or ${cs}`;
          onError(token, "TAG_RESOLVE_FAILED", msg, true);
        }
      }
      return tag;
    }
    exports.composeScalar = composeScalar;
  }
});

// node_modules/yaml/dist/compose/util-empty-scalar-position.js
var require_util_empty_scalar_position = __commonJS({
  "node_modules/yaml/dist/compose/util-empty-scalar-position.js"(exports) {
    "use strict";
    function emptyScalarPosition(offset, before, pos) {
      if (before) {
        pos ?? (pos = before.length);
        for (let i2 = pos - 1; i2 >= 0; --i2) {
          let st = before[i2];
          switch (st.type) {
            case "space":
            case "comment":
            case "newline":
              offset -= st.source.length;
              continue;
          }
          st = before[++i2];
          while (st?.type === "space") {
            offset += st.source.length;
            st = before[++i2];
          }
          break;
        }
      }
      return offset;
    }
    exports.emptyScalarPosition = emptyScalarPosition;
  }
});

// node_modules/yaml/dist/compose/compose-node.js
var require_compose_node = __commonJS({
  "node_modules/yaml/dist/compose/compose-node.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var composeCollection = require_compose_collection();
    var composeScalar = require_compose_scalar();
    var resolveEnd = require_resolve_end();
    var utilEmptyScalarPosition = require_util_empty_scalar_position();
    var CN = { composeNode, composeEmptyNode };
    function composeNode(ctx, token, props, onError) {
      const atKey = ctx.atKey;
      const { spaceBefore, comment, anchor, tag } = props;
      let node;
      let isSrcToken = true;
      switch (token.type) {
        case "alias":
          node = composeAlias(ctx, token, onError);
          if (anchor || tag)
            onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
          break;
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "block-scalar":
          node = composeScalar.composeScalar(ctx, token, tag, onError);
          if (anchor)
            node.anchor = anchor.source.substring(1);
          break;
        case "block-map":
        case "block-seq":
        case "flow-collection":
          try {
            node = composeCollection.composeCollection(CN, ctx, token, props, onError);
            if (anchor)
              node.anchor = anchor.source.substring(1);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            onError(token, "RESOURCE_EXHAUSTION", message);
          }
          break;
        default: {
          const message = token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`;
          onError(token, "UNEXPECTED_TOKEN", message);
          isSrcToken = false;
        }
      }
      node ?? (node = composeEmptyNode(ctx, token.offset, void 0, null, props, onError));
      if (anchor && node.anchor === "")
        onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      if (atKey && ctx.options.stringKeys && (!identity.isScalar(node) || typeof node.value !== "string" || node.tag && node.tag !== "tag:yaml.org,2002:str")) {
        const msg = "With stringKeys, all keys must be strings";
        onError(tag ?? token, "NON_STRING_KEY", msg);
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        if (token.type === "scalar" && token.source === "")
          node.comment = comment;
        else
          node.commentBefore = comment;
      }
      if (ctx.options.keepSourceTokens && isSrcToken)
        node.srcToken = token;
      return node;
    }
    function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor, tag, end }, onError) {
      const token = {
        type: "scalar",
        offset: utilEmptyScalarPosition.emptyScalarPosition(offset, before, pos),
        indent: -1,
        source: ""
      };
      const node = composeScalar.composeScalar(ctx, token, tag, onError);
      if (anchor) {
        node.anchor = anchor.source.substring(1);
        if (node.anchor === "")
          onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        node.comment = comment;
        node.range[2] = end;
      }
      return node;
    }
    function composeAlias({ options }, { offset, source, end }, onError) {
      const alias = new Alias.Alias(source.substring(1));
      if (alias.source === "")
        onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
      if (alias.source.endsWith(":"))
        onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, options.strict, onError);
      alias.range = [offset, valueEnd, re.offset];
      if (re.comment)
        alias.comment = re.comment;
      return alias;
    }
    exports.composeEmptyNode = composeEmptyNode;
    exports.composeNode = composeNode;
  }
});

// node_modules/yaml/dist/compose/compose-doc.js
var require_compose_doc = __commonJS({
  "node_modules/yaml/dist/compose/compose-doc.js"(exports) {
    "use strict";
    var Document = require_Document();
    var composeNode = require_compose_node();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    function composeDoc(options, directives, { offset, start, value, end }, onError) {
      const opts = Object.assign({ _directives: directives }, options);
      const doc = new Document.Document(void 0, opts);
      const ctx = {
        atKey: false,
        atRoot: true,
        directives: doc.directives,
        options: doc.options,
        schema: doc.schema
      };
      const props = resolveProps.resolveProps(start, {
        indicator: "doc-start",
        next: value ?? end?.[0],
        offset,
        onError,
        parentIndent: 0,
        startOnNewline: true
      });
      if (props.found) {
        doc.directives.docStart = true;
        if (value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline)
          onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker");
      }
      doc.contents = value ? composeNode.composeNode(ctx, value, props, onError) : composeNode.composeEmptyNode(ctx, props.end, start, null, props, onError);
      const contentEnd = doc.contents.range[2];
      const re = resolveEnd.resolveEnd(end, contentEnd, false, onError);
      if (re.comment)
        doc.comment = re.comment;
      doc.range = [offset, contentEnd, re.offset];
      return doc;
    }
    exports.composeDoc = composeDoc;
  }
});

// node_modules/yaml/dist/compose/composer.js
var require_composer = __commonJS({
  "node_modules/yaml/dist/compose/composer.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var directives = require_directives();
    var Document = require_Document();
    var errors = require_errors();
    var identity = require_identity();
    var composeDoc = require_compose_doc();
    var resolveEnd = require_resolve_end();
    function getErrorPos(src) {
      if (typeof src === "number")
        return [src, src + 1];
      if (Array.isArray(src))
        return src.length === 2 ? src : [src[0], src[1]];
      const { offset, source } = src;
      return [offset, offset + (typeof source === "string" ? source.length : 1)];
    }
    function parsePrelude(prelude) {
      let comment = "";
      let atComment = false;
      let afterEmptyLine = false;
      for (let i2 = 0; i2 < prelude.length; ++i2) {
        const source = prelude[i2];
        switch (source[0]) {
          case "#":
            comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
            atComment = true;
            afterEmptyLine = false;
            break;
          case "%":
            if (prelude[i2 + 1]?.[0] !== "#")
              i2 += 1;
            atComment = false;
            break;
          default:
            if (!atComment)
              afterEmptyLine = true;
            atComment = false;
        }
      }
      return { comment, afterEmptyLine };
    }
    var Composer = class {
      constructor(options = {}) {
        this.doc = null;
        this.atDirectives = false;
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
        this.onError = (source, code, message, warning) => {
          const pos = getErrorPos(source);
          if (warning)
            this.warnings.push(new errors.YAMLWarning(pos, code, message));
          else
            this.errors.push(new errors.YAMLParseError(pos, code, message));
        };
        this.directives = new directives.Directives({ version: options.version || "1.2" });
        this.options = options;
      }
      decorate(doc, afterDoc) {
        const { comment, afterEmptyLine } = parsePrelude(this.prelude);
        if (comment) {
          const dc = doc.contents;
          if (afterDoc) {
            doc.comment = doc.comment ? `${doc.comment}
${comment}` : comment;
          } else if (afterEmptyLine || doc.directives.docStart || !dc) {
            doc.commentBefore = comment;
          } else if (identity.isCollection(dc) && !dc.flow && dc.items.length > 0) {
            let it = dc.items[0];
            if (identity.isPair(it))
              it = it.key;
            const cb = it.commentBefore;
            it.commentBefore = cb ? `${comment}
${cb}` : comment;
          } else {
            const cb = dc.commentBefore;
            dc.commentBefore = cb ? `${comment}
${cb}` : comment;
          }
        }
        if (afterDoc) {
          for (let i2 = 0; i2 < this.errors.length; ++i2)
            doc.errors.push(this.errors[i2]);
          for (let i2 = 0; i2 < this.warnings.length; ++i2)
            doc.warnings.push(this.warnings[i2]);
        } else {
          doc.errors = this.errors;
          doc.warnings = this.warnings;
        }
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
      }
      /**
       * Current stream status information.
       *
       * Mostly useful at the end of input for an empty stream.
       */
      streamInfo() {
        return {
          comment: parsePrelude(this.prelude).comment,
          directives: this.directives,
          errors: this.errors,
          warnings: this.warnings
        };
      }
      /**
       * Compose tokens into documents.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *compose(tokens, forceDoc = false, endOffset = -1) {
        for (const token of tokens)
          yield* this.next(token);
        yield* this.end(forceDoc, endOffset);
      }
      /** Advance the composer by one CST token. */
      *next(token) {
        if (node_process.env.LOG_STREAM)
          console.dir(token, { depth: null });
        switch (token.type) {
          case "directive":
            this.directives.add(token.source, (offset, message, warning) => {
              const pos = getErrorPos(token);
              pos[0] += offset;
              this.onError(pos, "BAD_DIRECTIVE", message, warning);
            });
            this.prelude.push(token.source);
            this.atDirectives = true;
            break;
          case "document": {
            const doc = composeDoc.composeDoc(this.options, this.directives, token, this.onError);
            if (this.atDirectives && !doc.directives.docStart)
              this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line");
            this.decorate(doc, false);
            if (this.doc)
              yield this.doc;
            this.doc = doc;
            this.atDirectives = false;
            break;
          }
          case "byte-order-mark":
          case "space":
            break;
          case "comment":
          case "newline":
            this.prelude.push(token.source);
            break;
          case "error": {
            const msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message;
            const error = new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
            if (this.atDirectives || !this.doc)
              this.errors.push(error);
            else
              this.doc.errors.push(error);
            break;
          }
          case "doc-end": {
            if (!this.doc) {
              const msg = "Unexpected doc-end without preceding document";
              this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg));
              break;
            }
            this.doc.directives.docEnd = true;
            const end = resolveEnd.resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
            this.decorate(this.doc, true);
            if (end.comment) {
              const dc = this.doc.comment;
              this.doc.comment = dc ? `${dc}
${end.comment}` : end.comment;
            }
            this.doc.range[2] = end.offset;
            break;
          }
          default:
            this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
        }
      }
      /**
       * Call at end of input to yield any remaining document.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *end(forceDoc = false, endOffset = -1) {
        if (this.doc) {
          this.decorate(this.doc, true);
          yield this.doc;
          this.doc = null;
        } else if (forceDoc) {
          const opts = Object.assign({ _directives: this.directives }, this.options);
          const doc = new Document.Document(void 0, opts);
          if (this.atDirectives)
            this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
          doc.range = [0, endOffset, endOffset];
          this.decorate(doc, false);
          yield doc;
        }
      }
    };
    exports.Composer = Composer;
  }
});

// node_modules/yaml/dist/parse/cst-scalar.js
var require_cst_scalar = __commonJS({
  "node_modules/yaml/dist/parse/cst-scalar.js"(exports) {
    "use strict";
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    var errors = require_errors();
    var stringifyString = require_stringifyString();
    function resolveAsScalar(token, strict = true, onError) {
      if (token) {
        const _onError = (pos, code, message) => {
          const offset = typeof pos === "number" ? pos : Array.isArray(pos) ? pos[0] : pos.offset;
          if (onError)
            onError(offset, code, message);
          else
            throw new errors.YAMLParseError([offset, offset + 1], code, message);
        };
        switch (token.type) {
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return resolveFlowScalar.resolveFlowScalar(token, strict, _onError);
          case "block-scalar":
            return resolveBlockScalar.resolveBlockScalar({ options: { strict } }, token, _onError);
        }
      }
      return null;
    }
    function createScalarToken(value, context) {
      const { implicitKey = false, indent, inFlow = false, offset = -1, type = "PLAIN" } = context;
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey,
        indent: indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      const end = context.end ?? [
        { type: "newline", offset: -1, indent, source: "\n" }
      ];
      switch (source[0]) {
        case "|":
        case ">": {
          const he = source.indexOf("\n");
          const head = source.substring(0, he);
          const body = source.substring(he + 1) + "\n";
          const props = [
            { type: "block-scalar-header", offset, indent, source: head }
          ];
          if (!addEndtoBlockProps(props, end))
            props.push({ type: "newline", offset: -1, indent, source: "\n" });
          return { type: "block-scalar", offset, indent, props, source: body };
        }
        case '"':
          return { type: "double-quoted-scalar", offset, indent, source, end };
        case "'":
          return { type: "single-quoted-scalar", offset, indent, source, end };
        default:
          return { type: "scalar", offset, indent, source, end };
      }
    }
    function setScalarValue(token, value, context = {}) {
      let { afterKey = false, implicitKey = false, inFlow = false, type } = context;
      let indent = "indent" in token ? token.indent : null;
      if (afterKey && typeof indent === "number")
        indent += 2;
      if (!type)
        switch (token.type) {
          case "single-quoted-scalar":
            type = "QUOTE_SINGLE";
            break;
          case "double-quoted-scalar":
            type = "QUOTE_DOUBLE";
            break;
          case "block-scalar": {
            const header = token.props[0];
            if (header.type !== "block-scalar-header")
              throw new Error("Invalid block scalar header");
            type = header.source[0] === ">" ? "BLOCK_FOLDED" : "BLOCK_LITERAL";
            break;
          }
          default:
            type = "PLAIN";
        }
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey: implicitKey || indent === null,
        indent: indent !== null && indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      switch (source[0]) {
        case "|":
        case ">":
          setBlockScalarValue(token, source);
          break;
        case '"':
          setFlowScalarValue(token, source, "double-quoted-scalar");
          break;
        case "'":
          setFlowScalarValue(token, source, "single-quoted-scalar");
          break;
        default:
          setFlowScalarValue(token, source, "scalar");
      }
    }
    function setBlockScalarValue(token, source) {
      const he = source.indexOf("\n");
      const head = source.substring(0, he);
      const body = source.substring(he + 1) + "\n";
      if (token.type === "block-scalar") {
        const header = token.props[0];
        if (header.type !== "block-scalar-header")
          throw new Error("Invalid block scalar header");
        header.source = head;
        token.source = body;
      } else {
        const { offset } = token;
        const indent = "indent" in token ? token.indent : -1;
        const props = [
          { type: "block-scalar-header", offset, indent, source: head }
        ];
        if (!addEndtoBlockProps(props, "end" in token ? token.end : void 0))
          props.push({ type: "newline", offset: -1, indent, source: "\n" });
        for (const key of Object.keys(token))
          if (key !== "type" && key !== "offset")
            delete token[key];
        Object.assign(token, { type: "block-scalar", indent, props, source: body });
      }
    }
    function addEndtoBlockProps(props, end) {
      if (end)
        for (const st of end)
          switch (st.type) {
            case "space":
            case "comment":
              props.push(st);
              break;
            case "newline":
              props.push(st);
              return true;
          }
      return false;
    }
    function setFlowScalarValue(token, source, type) {
      switch (token.type) {
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          token.type = type;
          token.source = source;
          break;
        case "block-scalar": {
          const end = token.props.slice(1);
          let oa = source.length;
          if (token.props[0].type === "block-scalar-header")
            oa -= token.props[0].source.length;
          for (const tok of end)
            tok.offset += oa;
          delete token.props;
          Object.assign(token, { type, source, end });
          break;
        }
        case "block-map":
        case "block-seq": {
          const offset = token.offset + source.length;
          const nl = { type: "newline", offset, indent: token.indent, source: "\n" };
          delete token.items;
          Object.assign(token, { type, source, end: [nl] });
          break;
        }
        default: {
          const indent = "indent" in token ? token.indent : -1;
          const end = "end" in token && Array.isArray(token.end) ? token.end.filter((st) => st.type === "space" || st.type === "comment" || st.type === "newline") : [];
          for (const key of Object.keys(token))
            if (key !== "type" && key !== "offset")
              delete token[key];
          Object.assign(token, { type, indent, source, end });
        }
      }
    }
    exports.createScalarToken = createScalarToken;
    exports.resolveAsScalar = resolveAsScalar;
    exports.setScalarValue = setScalarValue;
  }
});

// node_modules/yaml/dist/parse/cst-stringify.js
var require_cst_stringify = __commonJS({
  "node_modules/yaml/dist/parse/cst-stringify.js"(exports) {
    "use strict";
    var stringify6 = (cst) => "type" in cst ? stringifyToken(cst) : stringifyItem(cst);
    function stringifyToken(token) {
      switch (token.type) {
        case "block-scalar": {
          let res = "";
          for (const tok of token.props)
            res += stringifyToken(tok);
          return res + token.source;
        }
        case "block-map":
        case "block-seq": {
          let res = "";
          for (const item of token.items)
            res += stringifyItem(item);
          return res;
        }
        case "flow-collection": {
          let res = token.start.source;
          for (const item of token.items)
            res += stringifyItem(item);
          for (const st of token.end)
            res += st.source;
          return res;
        }
        case "document": {
          let res = stringifyItem(token);
          if (token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
        default: {
          let res = token.source;
          if ("end" in token && token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
      }
    }
    function stringifyItem({ start, key, sep, value }) {
      let res = "";
      for (const st of start)
        res += st.source;
      if (key)
        res += stringifyToken(key);
      if (sep)
        for (const st of sep)
          res += st.source;
      if (value)
        res += stringifyToken(value);
      return res;
    }
    exports.stringify = stringify6;
  }
});

// node_modules/yaml/dist/parse/cst-visit.js
var require_cst_visit = __commonJS({
  "node_modules/yaml/dist/parse/cst-visit.js"(exports) {
    "use strict";
    var BREAK = Symbol("break visit");
    var SKIP = Symbol("skip children");
    var REMOVE = Symbol("remove item");
    function visit(cst, visitor) {
      if ("type" in cst && cst.type === "document")
        cst = { start: cst.start, value: cst.value };
      _visit(Object.freeze([]), cst, visitor);
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    visit.itemAtPath = (cst, path27) => {
      let item = cst;
      for (const [field, index] of path27) {
        const tok = item?.[field];
        if (tok && "items" in tok) {
          item = tok.items[index];
        } else
          return void 0;
      }
      return item;
    };
    visit.parentCollection = (cst, path27) => {
      const parent = visit.itemAtPath(cst, path27.slice(0, -1));
      const field = path27[path27.length - 1][0];
      const coll = parent?.[field];
      if (coll && "items" in coll)
        return coll;
      throw new Error("Parent collection not found");
    };
    function _visit(path27, item, visitor) {
      let ctrl = visitor(item, path27);
      if (typeof ctrl === "symbol")
        return ctrl;
      for (const field of ["key", "value"]) {
        const token = item[field];
        if (token && "items" in token) {
          for (let i2 = 0; i2 < token.items.length; ++i2) {
            const ci = _visit(Object.freeze(path27.concat([[field, i2]])), token.items[i2], visitor);
            if (typeof ci === "number")
              i2 = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              token.items.splice(i2, 1);
              i2 -= 1;
            }
          }
          if (typeof ctrl === "function" && field === "key")
            ctrl = ctrl(item, path27);
        }
      }
      return typeof ctrl === "function" ? ctrl(item, path27) : ctrl;
    }
    exports.visit = visit;
  }
});

// node_modules/yaml/dist/parse/cst.js
var require_cst = __commonJS({
  "node_modules/yaml/dist/parse/cst.js"(exports) {
    "use strict";
    var cstScalar = require_cst_scalar();
    var cstStringify = require_cst_stringify();
    var cstVisit = require_cst_visit();
    var BOM = "\uFEFF";
    var DOCUMENT = "";
    var FLOW_END = "";
    var SCALAR = "";
    var isCollection = (token) => !!token && "items" in token;
    var isScalar = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
    function prettyToken(token) {
      switch (token) {
        case BOM:
          return "<BOM>";
        case DOCUMENT:
          return "<DOC>";
        case FLOW_END:
          return "<FLOW_END>";
        case SCALAR:
          return "<SCALAR>";
        default:
          return JSON.stringify(token);
      }
    }
    function tokenType(source) {
      switch (source) {
        case BOM:
          return "byte-order-mark";
        case DOCUMENT:
          return "doc-mode";
        case FLOW_END:
          return "flow-error-end";
        case SCALAR:
          return "scalar";
        case "---":
          return "doc-start";
        case "...":
          return "doc-end";
        case "":
        case "\n":
        case "\r\n":
          return "newline";
        case "-":
          return "seq-item-ind";
        case "?":
          return "explicit-key-ind";
        case ":":
          return "map-value-ind";
        case "{":
          return "flow-map-start";
        case "}":
          return "flow-map-end";
        case "[":
          return "flow-seq-start";
        case "]":
          return "flow-seq-end";
        case ",":
          return "comma";
      }
      switch (source[0]) {
        case " ":
        case "	":
          return "space";
        case "#":
          return "comment";
        case "%":
          return "directive-line";
        case "*":
          return "alias";
        case "&":
          return "anchor";
        case "!":
          return "tag";
        case "'":
          return "single-quoted-scalar";
        case '"':
          return "double-quoted-scalar";
        case "|":
        case ">":
          return "block-scalar-header";
      }
      return null;
    }
    exports.createScalarToken = cstScalar.createScalarToken;
    exports.resolveAsScalar = cstScalar.resolveAsScalar;
    exports.setScalarValue = cstScalar.setScalarValue;
    exports.stringify = cstStringify.stringify;
    exports.visit = cstVisit.visit;
    exports.BOM = BOM;
    exports.DOCUMENT = DOCUMENT;
    exports.FLOW_END = FLOW_END;
    exports.SCALAR = SCALAR;
    exports.isCollection = isCollection;
    exports.isScalar = isScalar;
    exports.prettyToken = prettyToken;
    exports.tokenType = tokenType;
  }
});

// node_modules/yaml/dist/parse/lexer.js
var require_lexer = __commonJS({
  "node_modules/yaml/dist/parse/lexer.js"(exports) {
    "use strict";
    var cst = require_cst();
    function isEmpty(ch) {
      switch (ch) {
        case void 0:
        case " ":
        case "\n":
        case "\r":
        case "	":
          return true;
        default:
          return false;
      }
    }
    var hexDigits = new Set("0123456789ABCDEFabcdef");
    var tagChars = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()");
    var flowIndicatorChars = new Set(",[]{}");
    var invalidAnchorChars = new Set(" ,[]{}\n\r	");
    var isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);
    var Lexer = class {
      constructor() {
        this.atEnd = false;
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        this.buffer = "";
        this.flowKey = false;
        this.flowLevel = 0;
        this.indentNext = 0;
        this.indentValue = 0;
        this.lineEndPos = null;
        this.next = null;
        this.pos = 0;
      }
      /**
       * Generate YAML tokens from the `source` string. If `incomplete`,
       * a part of the last line may be left as a buffer for the next call.
       *
       * @returns A generator of lexical tokens
       */
      *lex(source, incomplete = false) {
        if (source) {
          if (typeof source !== "string")
            throw TypeError("source is not a string");
          this.buffer = this.buffer ? this.buffer + source : source;
          this.lineEndPos = null;
        }
        this.atEnd = !incomplete;
        let next = this.next ?? "stream";
        while (next && (incomplete || this.hasChars(1)))
          next = yield* this.parseNext(next);
      }
      atLineEnd() {
        let i2 = this.pos;
        let ch = this.buffer[i2];
        while (ch === " " || ch === "	")
          ch = this.buffer[++i2];
        if (!ch || ch === "#" || ch === "\n")
          return true;
        if (ch === "\r")
          return this.buffer[i2 + 1] === "\n";
        return false;
      }
      charAt(n3) {
        return this.buffer[this.pos + n3];
      }
      continueScalar(offset) {
        let ch = this.buffer[offset];
        if (this.indentNext > 0) {
          let indent = 0;
          while (ch === " ")
            ch = this.buffer[++indent + offset];
          if (ch === "\r") {
            const next = this.buffer[indent + offset + 1];
            if (next === "\n" || !next && !this.atEnd)
              return offset + indent + 1;
          }
          return ch === "\n" || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
        }
        if (ch === "-" || ch === ".") {
          const dt = this.buffer.substr(offset, 3);
          if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3]))
            return -1;
        }
        return offset;
      }
      getLine() {
        let end = this.lineEndPos;
        if (typeof end !== "number" || end !== -1 && end < this.pos) {
          end = this.buffer.indexOf("\n", this.pos);
          this.lineEndPos = end;
        }
        if (end === -1)
          return this.atEnd ? this.buffer.substring(this.pos) : null;
        if (this.buffer[end - 1] === "\r")
          end -= 1;
        return this.buffer.substring(this.pos, end);
      }
      hasChars(n3) {
        return this.pos + n3 <= this.buffer.length;
      }
      setNext(state) {
        this.buffer = this.buffer.substring(this.pos);
        this.pos = 0;
        this.lineEndPos = null;
        this.next = state;
        return null;
      }
      peek(n3) {
        return this.buffer.substr(this.pos, n3);
      }
      *parseNext(next) {
        switch (next) {
          case "stream":
            return yield* this.parseStream();
          case "line-start":
            return yield* this.parseLineStart();
          case "block-start":
            return yield* this.parseBlockStart();
          case "doc":
            return yield* this.parseDocument();
          case "flow":
            return yield* this.parseFlowCollection();
          case "quoted-scalar":
            return yield* this.parseQuotedScalar();
          case "block-scalar":
            return yield* this.parseBlockScalar();
          case "plain-scalar":
            return yield* this.parsePlainScalar();
        }
      }
      *parseStream() {
        let line = this.getLine();
        if (line === null)
          return this.setNext("stream");
        if (line[0] === cst.BOM) {
          yield* this.pushCount(1);
          line = line.substring(1);
        }
        if (line[0] === "%") {
          let dirEnd = line.length;
          let cs = line.indexOf("#");
          while (cs !== -1) {
            const ch = line[cs - 1];
            if (ch === " " || ch === "	") {
              dirEnd = cs - 1;
              break;
            } else {
              cs = line.indexOf("#", cs + 1);
            }
          }
          while (true) {
            const ch = line[dirEnd - 1];
            if (ch === " " || ch === "	")
              dirEnd -= 1;
            else
              break;
          }
          const n3 = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
          yield* this.pushCount(line.length - n3);
          this.pushNewline();
          return "stream";
        }
        if (this.atLineEnd()) {
          const sp = yield* this.pushSpaces(true);
          yield* this.pushCount(line.length - sp);
          yield* this.pushNewline();
          return "stream";
        }
        yield cst.DOCUMENT;
        return yield* this.parseLineStart();
      }
      *parseLineStart() {
        const ch = this.charAt(0);
        if (!ch && !this.atEnd)
          return this.setNext("line-start");
        if (ch === "-" || ch === ".") {
          if (!this.atEnd && !this.hasChars(4))
            return this.setNext("line-start");
          const s = this.peek(3);
          if ((s === "---" || s === "...") && isEmpty(this.charAt(3))) {
            yield* this.pushCount(3);
            this.indentValue = 0;
            this.indentNext = 0;
            return s === "---" ? "doc" : "stream";
          }
        }
        this.indentValue = yield* this.pushSpaces(false);
        if (this.indentNext > this.indentValue && !isEmpty(this.charAt(1)))
          this.indentNext = this.indentValue;
        return yield* this.parseBlockStart();
      }
      *parseBlockStart() {
        const [ch0, ch1] = this.peek(2);
        if (!ch1 && !this.atEnd)
          return this.setNext("block-start");
        if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
          const n3 = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
          this.indentNext = this.indentValue + 1;
          this.indentValue += n3;
          return "block-start";
        }
        return "doc";
      }
      *parseDocument() {
        yield* this.pushSpaces(true);
        const line = this.getLine();
        if (line === null)
          return this.setNext("doc");
        let n3 = yield* this.pushIndicators();
        switch (line[n3]) {
          case "#":
            yield* this.pushCount(line.length - n3);
          // fallthrough
          case void 0:
            yield* this.pushNewline();
            return yield* this.parseLineStart();
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel = 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            return "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "doc";
          case '"':
          case "'":
            return yield* this.parseQuotedScalar();
          case "|":
          case ">":
            n3 += yield* this.parseBlockScalarHeader();
            n3 += yield* this.pushSpaces(true);
            yield* this.pushCount(line.length - n3);
            yield* this.pushNewline();
            return yield* this.parseBlockScalar();
          default:
            return yield* this.parsePlainScalar();
        }
      }
      *parseFlowCollection() {
        let nl, sp;
        let indent = -1;
        do {
          nl = yield* this.pushNewline();
          if (nl > 0) {
            sp = yield* this.pushSpaces(false);
            this.indentValue = indent = sp;
          } else {
            sp = 0;
          }
          sp += yield* this.pushSpaces(true);
        } while (nl + sp > 0);
        const line = this.getLine();
        if (line === null)
          return this.setNext("flow");
        if (indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) {
          const atFlowEndMarker = indent === this.indentNext - 1 && this.flowLevel === 1 && (line[0] === "]" || line[0] === "}");
          if (!atFlowEndMarker) {
            this.flowLevel = 0;
            yield cst.FLOW_END;
            return yield* this.parseLineStart();
          }
        }
        let n3 = 0;
        while (line[n3] === ",") {
          n3 += yield* this.pushCount(1);
          n3 += yield* this.pushSpaces(true);
          this.flowKey = false;
        }
        n3 += yield* this.pushIndicators();
        switch (line[n3]) {
          case void 0:
            return "flow";
          case "#":
            yield* this.pushCount(line.length - n3);
            return "flow";
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel += 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            this.flowKey = true;
            this.flowLevel -= 1;
            return this.flowLevel ? "flow" : "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "flow";
          case '"':
          case "'":
            this.flowKey = true;
            return yield* this.parseQuotedScalar();
          case ":": {
            const next = this.charAt(1);
            if (this.flowKey || isEmpty(next) || next === ",") {
              this.flowKey = false;
              yield* this.pushCount(1);
              yield* this.pushSpaces(true);
              return "flow";
            }
          }
          // fallthrough
          default:
            this.flowKey = false;
            return yield* this.parsePlainScalar();
        }
      }
      *parseQuotedScalar() {
        const quote = this.charAt(0);
        let end = this.buffer.indexOf(quote, this.pos + 1);
        if (quote === "'") {
          while (end !== -1 && this.buffer[end + 1] === "'")
            end = this.buffer.indexOf("'", end + 2);
        } else {
          while (end !== -1) {
            let n3 = 0;
            while (this.buffer[end - 1 - n3] === "\\")
              n3 += 1;
            if (n3 % 2 === 0)
              break;
            end = this.buffer.indexOf('"', end + 1);
          }
        }
        const qb = this.buffer.substring(0, end);
        let nl = qb.indexOf("\n", this.pos);
        if (nl !== -1) {
          while (nl !== -1) {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = qb.indexOf("\n", cs);
          }
          if (nl !== -1) {
            end = nl - (qb[nl - 1] === "\r" ? 2 : 1);
          }
        }
        if (end === -1) {
          if (!this.atEnd)
            return this.setNext("quoted-scalar");
          end = this.buffer.length;
        }
        yield* this.pushToIndex(end + 1, false);
        return this.flowLevel ? "flow" : "doc";
      }
      *parseBlockScalarHeader() {
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        let i2 = this.pos;
        while (true) {
          const ch = this.buffer[++i2];
          if (ch === "+")
            this.blockScalarKeep = true;
          else if (ch > "0" && ch <= "9")
            this.blockScalarIndent = Number(ch) - 1;
          else if (ch !== "-")
            break;
        }
        return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
      }
      *parseBlockScalar() {
        let nl = this.pos - 1;
        let indent = 0;
        let ch;
        loop: for (let i3 = this.pos; ch = this.buffer[i3]; ++i3) {
          switch (ch) {
            case " ":
              indent += 1;
              break;
            case "\n":
              nl = i3;
              indent = 0;
              break;
            case "\r": {
              const next = this.buffer[i3 + 1];
              if (!next && !this.atEnd)
                return this.setNext("block-scalar");
              if (next === "\n")
                break;
            }
            // fallthrough
            default:
              break loop;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("block-scalar");
        if (indent >= this.indentNext) {
          if (this.blockScalarIndent === -1)
            this.indentNext = indent;
          else {
            this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
          }
          do {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = this.buffer.indexOf("\n", cs);
          } while (nl !== -1);
          if (nl === -1) {
            if (!this.atEnd)
              return this.setNext("block-scalar");
            nl = this.buffer.length;
          }
        }
        let i2 = nl + 1;
        ch = this.buffer[i2];
        while (ch === " ")
          ch = this.buffer[++i2];
        if (ch === "	") {
          while (ch === "	" || ch === " " || ch === "\r" || ch === "\n")
            ch = this.buffer[++i2];
          nl = i2 - 1;
        } else if (!this.blockScalarKeep) {
          do {
            let i3 = nl - 1;
            let ch2 = this.buffer[i3];
            if (ch2 === "\r")
              ch2 = this.buffer[--i3];
            const lastChar = i3;
            while (ch2 === " ")
              ch2 = this.buffer[--i3];
            if (ch2 === "\n" && i3 >= this.pos && i3 + 1 + indent > lastChar)
              nl = i3;
            else
              break;
          } while (true);
        }
        yield cst.SCALAR;
        yield* this.pushToIndex(nl + 1, true);
        return yield* this.parseLineStart();
      }
      *parsePlainScalar() {
        const inFlow = this.flowLevel > 0;
        let end = this.pos - 1;
        let i2 = this.pos - 1;
        let ch;
        while (ch = this.buffer[++i2]) {
          if (ch === ":") {
            const next = this.buffer[i2 + 1];
            if (isEmpty(next) || inFlow && flowIndicatorChars.has(next))
              break;
            end = i2;
          } else if (isEmpty(ch)) {
            let next = this.buffer[i2 + 1];
            if (ch === "\r") {
              if (next === "\n") {
                i2 += 1;
                ch = "\n";
                next = this.buffer[i2 + 1];
              } else
                end = i2;
            }
            if (next === "#" || inFlow && flowIndicatorChars.has(next))
              break;
            if (ch === "\n") {
              const cs = this.continueScalar(i2 + 1);
              if (cs === -1)
                break;
              i2 = Math.max(i2, cs - 2);
            }
          } else {
            if (inFlow && flowIndicatorChars.has(ch))
              break;
            end = i2;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("plain-scalar");
        yield cst.SCALAR;
        yield* this.pushToIndex(end + 1, true);
        return inFlow ? "flow" : "doc";
      }
      *pushCount(n3) {
        if (n3 > 0) {
          yield this.buffer.substr(this.pos, n3);
          this.pos += n3;
          return n3;
        }
        return 0;
      }
      *pushToIndex(i2, allowEmpty) {
        const s = this.buffer.slice(this.pos, i2);
        if (s) {
          yield s;
          this.pos += s.length;
          return s.length;
        } else if (allowEmpty)
          yield "";
        return 0;
      }
      *pushIndicators() {
        let n3 = 0;
        loop: while (true) {
          switch (this.charAt(0)) {
            case "!":
              n3 += yield* this.pushTag();
              n3 += yield* this.pushSpaces(true);
              continue loop;
            case "&":
              n3 += yield* this.pushUntil(isNotAnchorChar);
              n3 += yield* this.pushSpaces(true);
              continue loop;
            case "-":
            // this is an error
            case "?":
            // this is an error outside flow collections
            case ":": {
              const inFlow = this.flowLevel > 0;
              const ch1 = this.charAt(1);
              if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
                if (!inFlow)
                  this.indentNext = this.indentValue + 1;
                else if (this.flowKey)
                  this.flowKey = false;
                n3 += yield* this.pushCount(1);
                n3 += yield* this.pushSpaces(true);
                continue loop;
              }
            }
          }
          break loop;
        }
        return n3;
      }
      *pushTag() {
        if (this.charAt(1) === "<") {
          let i2 = this.pos + 2;
          let ch = this.buffer[i2];
          while (!isEmpty(ch) && ch !== ">")
            ch = this.buffer[++i2];
          return yield* this.pushToIndex(ch === ">" ? i2 + 1 : i2, false);
        } else {
          let i2 = this.pos + 1;
          let ch = this.buffer[i2];
          while (ch) {
            if (tagChars.has(ch))
              ch = this.buffer[++i2];
            else if (ch === "%" && hexDigits.has(this.buffer[i2 + 1]) && hexDigits.has(this.buffer[i2 + 2])) {
              ch = this.buffer[i2 += 3];
            } else
              break;
          }
          return yield* this.pushToIndex(i2, false);
        }
      }
      *pushNewline() {
        const ch = this.buffer[this.pos];
        if (ch === "\n")
          return yield* this.pushCount(1);
        else if (ch === "\r" && this.charAt(1) === "\n")
          return yield* this.pushCount(2);
        else
          return 0;
      }
      *pushSpaces(allowTabs) {
        let i2 = this.pos - 1;
        let ch;
        do {
          ch = this.buffer[++i2];
        } while (ch === " " || allowTabs && ch === "	");
        const n3 = i2 - this.pos;
        if (n3 > 0) {
          yield this.buffer.substr(this.pos, n3);
          this.pos = i2;
        }
        return n3;
      }
      *pushUntil(test) {
        let i2 = this.pos;
        let ch = this.buffer[i2];
        while (!test(ch))
          ch = this.buffer[++i2];
        return yield* this.pushToIndex(i2, false);
      }
    };
    exports.Lexer = Lexer;
  }
});

// node_modules/yaml/dist/parse/line-counter.js
var require_line_counter = __commonJS({
  "node_modules/yaml/dist/parse/line-counter.js"(exports) {
    "use strict";
    var LineCounter = class {
      constructor() {
        this.lineStarts = [];
        this.addNewLine = (offset) => this.lineStarts.push(offset);
        this.linePos = (offset) => {
          let low = 0;
          let high = this.lineStarts.length;
          while (low < high) {
            const mid = low + high >> 1;
            if (this.lineStarts[mid] < offset)
              low = mid + 1;
            else
              high = mid;
          }
          if (this.lineStarts[low] === offset)
            return { line: low + 1, col: 1 };
          if (low === 0)
            return { line: 0, col: offset };
          const start = this.lineStarts[low - 1];
          return { line: low, col: offset - start + 1 };
        };
      }
    };
    exports.LineCounter = LineCounter;
  }
});

// node_modules/yaml/dist/parse/parser.js
var require_parser = __commonJS({
  "node_modules/yaml/dist/parse/parser.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var cst = require_cst();
    var lexer = require_lexer();
    function includesToken(list, type) {
      for (let i2 = 0; i2 < list.length; ++i2)
        if (list[i2].type === type)
          return true;
      return false;
    }
    function findNonEmptyIndex(list) {
      for (let i2 = 0; i2 < list.length; ++i2) {
        switch (list[i2].type) {
          case "space":
          case "comment":
          case "newline":
            break;
          default:
            return i2;
        }
      }
      return -1;
    }
    function isFlowToken(token) {
      switch (token?.type) {
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "flow-collection":
          return true;
        default:
          return false;
      }
    }
    function getPrevProps(parent) {
      switch (parent.type) {
        case "document":
          return parent.start;
        case "block-map": {
          const it = parent.items[parent.items.length - 1];
          return it.sep ?? it.start;
        }
        case "block-seq":
          return parent.items[parent.items.length - 1].start;
        /* istanbul ignore next should not happen */
        default:
          return [];
      }
    }
    function getFirstKeyStartProps(prev) {
      if (prev.length === 0)
        return [];
      let i2 = prev.length;
      loop: while (--i2 >= 0) {
        switch (prev[i2].type) {
          case "doc-start":
          case "explicit-key-ind":
          case "map-value-ind":
          case "seq-item-ind":
          case "newline":
            break loop;
        }
      }
      while (prev[++i2]?.type === "space") {
      }
      return prev.splice(i2, prev.length);
    }
    function arrayPushArray(target, source) {
      if (source.length < 1e5)
        Array.prototype.push.apply(target, source);
      else
        for (let i2 = 0; i2 < source.length; ++i2)
          target.push(source[i2]);
    }
    function fixFlowSeqItems(fc) {
      if (fc.start.type === "flow-seq-start") {
        for (const it of fc.items) {
          if (it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind")) {
            if (it.key)
              it.value = it.key;
            delete it.key;
            if (isFlowToken(it.value)) {
              if (it.value.end)
                arrayPushArray(it.value.end, it.sep);
              else
                it.value.end = it.sep;
            } else
              arrayPushArray(it.start, it.sep);
            delete it.sep;
          }
        }
      }
    }
    var Parser = class {
      /**
       * @param onNewLine - If defined, called separately with the start position of
       *   each new line (in `parse()`, including the start of input).
       */
      constructor(onNewLine) {
        this.atNewLine = true;
        this.atScalar = false;
        this.indent = 0;
        this.offset = 0;
        this.onKeyLine = false;
        this.stack = [];
        this.source = "";
        this.type = "";
        this.lexer = new lexer.Lexer();
        this.onNewLine = onNewLine;
      }
      /**
       * Parse `source` as a YAML stream.
       * If `incomplete`, a part of the last line may be left as a buffer for the next call.
       *
       * Errors are not thrown, but yielded as `{ type: 'error', message }` tokens.
       *
       * @returns A generator of tokens representing each directive, document, and other structure.
       */
      *parse(source, incomplete = false) {
        if (this.onNewLine && this.offset === 0)
          this.onNewLine(0);
        for (const lexeme of this.lexer.lex(source, incomplete))
          yield* this.next(lexeme);
        if (!incomplete)
          yield* this.end();
      }
      /**
       * Advance the parser by the `source` of one lexical token.
       */
      *next(source) {
        this.source = source;
        if (node_process.env.LOG_TOKENS)
          console.log("|", cst.prettyToken(source));
        if (this.atScalar) {
          this.atScalar = false;
          yield* this.step();
          this.offset += source.length;
          return;
        }
        const type = cst.tokenType(source);
        if (!type) {
          const message = `Not a YAML token: ${source}`;
          yield* this.pop({ type: "error", offset: this.offset, message, source });
          this.offset += source.length;
        } else if (type === "scalar") {
          this.atNewLine = false;
          this.atScalar = true;
          this.type = "scalar";
        } else {
          this.type = type;
          yield* this.step();
          switch (type) {
            case "newline":
              this.atNewLine = true;
              this.indent = 0;
              if (this.onNewLine)
                this.onNewLine(this.offset + source.length);
              break;
            case "space":
              if (this.atNewLine && source[0] === " ")
                this.indent += source.length;
              break;
            case "explicit-key-ind":
            case "map-value-ind":
            case "seq-item-ind":
              if (this.atNewLine)
                this.indent += source.length;
              break;
            case "doc-mode":
            case "flow-error-end":
              return;
            default:
              this.atNewLine = false;
          }
          this.offset += source.length;
        }
      }
      /** Call at end of input to push out any remaining constructions */
      *end() {
        while (this.stack.length > 0)
          yield* this.pop();
      }
      get sourceToken() {
        const st = {
          type: this.type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
        return st;
      }
      *step() {
        const top = this.peek(1);
        if (this.type === "doc-end" && top?.type !== "doc-end") {
          while (this.stack.length > 0)
            yield* this.pop();
          this.stack.push({
            type: "doc-end",
            offset: this.offset,
            source: this.source
          });
          return;
        }
        if (!top)
          return yield* this.stream();
        switch (top.type) {
          case "document":
            return yield* this.document(top);
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return yield* this.scalar(top);
          case "block-scalar":
            return yield* this.blockScalar(top);
          case "block-map":
            return yield* this.blockMap(top);
          case "block-seq":
            return yield* this.blockSequence(top);
          case "flow-collection":
            return yield* this.flowCollection(top);
          case "doc-end":
            return yield* this.documentEnd(top);
        }
        yield* this.pop();
      }
      peek(n3) {
        return this.stack[this.stack.length - n3];
      }
      *pop(error) {
        const token = error ?? this.stack.pop();
        if (!token) {
          const message = "Tried to pop an empty stack";
          yield { type: "error", offset: this.offset, source: "", message };
        } else if (this.stack.length === 0) {
          yield token;
        } else {
          const top = this.peek(1);
          if (token.type === "block-scalar") {
            token.indent = "indent" in top ? top.indent : 0;
          } else if (token.type === "flow-collection" && top.type === "document") {
            token.indent = 0;
          }
          if (token.type === "flow-collection")
            fixFlowSeqItems(token);
          switch (top.type) {
            case "document":
              top.value = token;
              break;
            case "block-scalar":
              top.props.push(token);
              break;
            case "block-map": {
              const it = top.items[top.items.length - 1];
              if (it.value) {
                top.items.push({ start: [], key: token, sep: [] });
                this.onKeyLine = true;
                return;
              } else if (it.sep) {
                it.value = token;
              } else {
                Object.assign(it, { key: token, sep: [] });
                this.onKeyLine = !it.explicitKey;
                return;
              }
              break;
            }
            case "block-seq": {
              const it = top.items[top.items.length - 1];
              if (it.value)
                top.items.push({ start: [], value: token });
              else
                it.value = token;
              break;
            }
            case "flow-collection": {
              const it = top.items[top.items.length - 1];
              if (!it || it.value)
                top.items.push({ start: [], key: token, sep: [] });
              else if (it.sep)
                it.value = token;
              else
                Object.assign(it, { key: token, sep: [] });
              return;
            }
            /* istanbul ignore next should not happen */
            default:
              yield* this.pop();
              yield* this.pop(token);
          }
          if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
            const last = token.items[token.items.length - 1];
            if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent))) {
              if (top.type === "document")
                top.end = last.start;
              else
                top.items.push({ start: last.start });
              token.items.splice(-1, 1);
            }
          }
        }
      }
      *stream() {
        switch (this.type) {
          case "directive-line":
            yield { type: "directive", offset: this.offset, source: this.source };
            return;
          case "byte-order-mark":
          case "space":
          case "comment":
          case "newline":
            yield this.sourceToken;
            return;
          case "doc-mode":
          case "doc-start": {
            const doc = {
              type: "document",
              offset: this.offset,
              start: []
            };
            if (this.type === "doc-start")
              doc.start.push(this.sourceToken);
            this.stack.push(doc);
            return;
          }
        }
        yield {
          type: "error",
          offset: this.offset,
          message: `Unexpected ${this.type} token in YAML stream`,
          source: this.source
        };
      }
      *document(doc) {
        if (doc.value)
          return yield* this.lineEnd(doc);
        switch (this.type) {
          case "doc-start": {
            if (findNonEmptyIndex(doc.start) !== -1) {
              yield* this.pop();
              yield* this.step();
            } else
              doc.start.push(this.sourceToken);
            return;
          }
          case "anchor":
          case "tag":
          case "space":
          case "comment":
          case "newline":
            doc.start.push(this.sourceToken);
            return;
        }
        const bv = this.startBlockValue(doc);
        if (bv)
          this.stack.push(bv);
        else {
          yield {
            type: "error",
            offset: this.offset,
            message: `Unexpected ${this.type} token in YAML document`,
            source: this.source
          };
        }
      }
      *scalar(scalar) {
        if (this.type === "map-value-ind") {
          const prev = getPrevProps(this.peek(2));
          const start = getFirstKeyStartProps(prev);
          let sep;
          if (scalar.end) {
            sep = scalar.end;
            sep.push(this.sourceToken);
            delete scalar.end;
          } else
            sep = [this.sourceToken];
          const map = {
            type: "block-map",
            offset: scalar.offset,
            indent: scalar.indent,
            items: [{ start, key: scalar, sep }]
          };
          this.onKeyLine = true;
          this.stack[this.stack.length - 1] = map;
        } else
          yield* this.lineEnd(scalar);
      }
      *blockScalar(scalar) {
        switch (this.type) {
          case "space":
          case "comment":
          case "newline":
            scalar.props.push(this.sourceToken);
            return;
          case "scalar":
            scalar.source = this.source;
            this.atNewLine = true;
            this.indent = 0;
            if (this.onNewLine) {
              let nl = this.source.indexOf("\n") + 1;
              while (nl !== 0) {
                this.onNewLine(this.offset + nl);
                nl = this.source.indexOf("\n", nl) + 1;
              }
            }
            yield* this.pop();
            break;
          /* istanbul ignore next should not happen */
          default:
            yield* this.pop();
            yield* this.step();
        }
      }
      *blockMap(map) {
        const it = map.items[map.items.length - 1];
        switch (this.type) {
          case "newline":
            this.onKeyLine = false;
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              it.start.push(this.sourceToken);
            }
            return;
          case "space":
          case "comment":
            if (it.value) {
              map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              if (this.atIndentedComment(it.start, map.indent)) {
                const prev = map.items[map.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  map.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
        }
        if (this.indent >= map.indent) {
          const atMapIndent = !this.onKeyLine && this.indent === map.indent;
          const atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind";
          let start = [];
          if (atNextItem && it.sep && !it.value) {
            const nl = [];
            for (let i2 = 0; i2 < it.sep.length; ++i2) {
              const st = it.sep[i2];
              switch (st.type) {
                case "newline":
                  nl.push(i2);
                  break;
                case "space":
                  break;
                case "comment":
                  if (st.indent > map.indent)
                    nl.length = 0;
                  break;
                default:
                  nl.length = 0;
              }
            }
            if (nl.length >= 2)
              start = it.sep.splice(nl[1]);
          }
          switch (this.type) {
            case "anchor":
            case "tag":
              if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start });
                this.onKeyLine = true;
              } else if (it.sep) {
                it.sep.push(this.sourceToken);
              } else {
                it.start.push(this.sourceToken);
              }
              return;
            case "explicit-key-ind":
              if (!it.sep && !it.explicitKey) {
                it.start.push(this.sourceToken);
                it.explicitKey = true;
              } else if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start, explicitKey: true });
              } else {
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: [this.sourceToken], explicitKey: true }]
                });
              }
              this.onKeyLine = true;
              return;
            case "map-value-ind":
              if (it.explicitKey) {
                if (!it.sep) {
                  if (includesToken(it.start, "newline")) {
                    Object.assign(it, { key: null, sep: [this.sourceToken] });
                  } else {
                    const start2 = getFirstKeyStartProps(it.start);
                    this.stack.push({
                      type: "block-map",
                      offset: this.offset,
                      indent: this.indent,
                      items: [{ start: start2, key: null, sep: [this.sourceToken] }]
                    });
                  }
                } else if (it.value) {
                  map.items.push({ start: [], key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start, key: null, sep: [this.sourceToken] }]
                  });
                } else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
                  const start2 = getFirstKeyStartProps(it.start);
                  const key = it.key;
                  const sep = it.sep;
                  sep.push(this.sourceToken);
                  delete it.key;
                  delete it.sep;
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: start2, key, sep }]
                  });
                } else if (start.length > 0) {
                  it.sep = it.sep.concat(start, this.sourceToken);
                } else {
                  it.sep.push(this.sourceToken);
                }
              } else {
                if (!it.sep) {
                  Object.assign(it, { key: null, sep: [this.sourceToken] });
                } else if (it.value || atNextItem) {
                  map.items.push({ start, key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: [], key: null, sep: [this.sourceToken] }]
                  });
                } else {
                  it.sep.push(this.sourceToken);
                }
              }
              this.onKeyLine = true;
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs29 = this.flowScalar(this.type);
              if (atNextItem || it.value) {
                map.items.push({ start, key: fs29, sep: [] });
                this.onKeyLine = true;
              } else if (it.sep) {
                this.stack.push(fs29);
              } else {
                Object.assign(it, { key: fs29, sep: [] });
                this.onKeyLine = true;
              }
              return;
            }
            default: {
              const bv = this.startBlockValue(map);
              if (bv) {
                if (bv.type === "block-seq") {
                  if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
                    yield* this.pop({
                      type: "error",
                      offset: this.offset,
                      message: "Unexpected block-seq-ind on same line with key",
                      source: this.source
                    });
                    return;
                  }
                } else if (atMapIndent) {
                  map.items.push({ start });
                }
                this.stack.push(bv);
                return;
              }
            }
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *blockSequence(seq) {
        const it = seq.items[seq.items.length - 1];
        switch (this.type) {
          case "newline":
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                seq.items.push({ start: [this.sourceToken] });
            } else
              it.start.push(this.sourceToken);
            return;
          case "space":
          case "comment":
            if (it.value)
              seq.items.push({ start: [this.sourceToken] });
            else {
              if (this.atIndentedComment(it.start, seq.indent)) {
                const prev = seq.items[seq.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  seq.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
          case "anchor":
          case "tag":
            if (it.value || this.indent <= seq.indent)
              break;
            it.start.push(this.sourceToken);
            return;
          case "seq-item-ind":
            if (this.indent !== seq.indent)
              break;
            if (it.value || includesToken(it.start, "seq-item-ind"))
              seq.items.push({ start: [this.sourceToken] });
            else
              it.start.push(this.sourceToken);
            return;
        }
        if (this.indent > seq.indent) {
          const bv = this.startBlockValue(seq);
          if (bv) {
            this.stack.push(bv);
            return;
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *flowCollection(fc) {
        const it = fc.items[fc.items.length - 1];
        if (this.type === "flow-error-end") {
          let top;
          do {
            yield* this.pop();
            top = this.peek(1);
          } while (top?.type === "flow-collection");
        } else if (fc.end.length === 0) {
          switch (this.type) {
            case "comma":
            case "explicit-key-ind":
              if (!it || it.sep)
                fc.items.push({ start: [this.sourceToken] });
              else
                it.start.push(this.sourceToken);
              return;
            case "map-value-ind":
              if (!it || it.value)
                fc.items.push({ start: [], key: null, sep: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                Object.assign(it, { key: null, sep: [this.sourceToken] });
              return;
            case "space":
            case "comment":
            case "newline":
            case "anchor":
            case "tag":
              if (!it || it.value)
                fc.items.push({ start: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                it.start.push(this.sourceToken);
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs29 = this.flowScalar(this.type);
              if (!it || it.value)
                fc.items.push({ start: [], key: fs29, sep: [] });
              else if (it.sep)
                this.stack.push(fs29);
              else
                Object.assign(it, { key: fs29, sep: [] });
              return;
            }
            case "flow-map-end":
            case "flow-seq-end":
              fc.end.push(this.sourceToken);
              return;
          }
          const bv = this.startBlockValue(fc);
          if (bv)
            this.stack.push(bv);
          else {
            yield* this.pop();
            yield* this.step();
          }
        } else {
          const parent = this.peek(2);
          if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) {
            yield* this.pop();
            yield* this.step();
          } else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            fixFlowSeqItems(fc);
            const sep = fc.end.splice(1, fc.end.length);
            sep.push(this.sourceToken);
            const map = {
              type: "block-map",
              offset: fc.offset,
              indent: fc.indent,
              items: [{ start, key: fc, sep }]
            };
            this.onKeyLine = true;
            this.stack[this.stack.length - 1] = map;
          } else {
            yield* this.lineEnd(fc);
          }
        }
      }
      flowScalar(type) {
        if (this.onNewLine) {
          let nl = this.source.indexOf("\n") + 1;
          while (nl !== 0) {
            this.onNewLine(this.offset + nl);
            nl = this.source.indexOf("\n", nl) + 1;
          }
        }
        return {
          type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
      }
      startBlockValue(parent) {
        switch (this.type) {
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return this.flowScalar(this.type);
          case "block-scalar-header":
            return {
              type: "block-scalar",
              offset: this.offset,
              indent: this.indent,
              props: [this.sourceToken],
              source: ""
            };
          case "flow-map-start":
          case "flow-seq-start":
            return {
              type: "flow-collection",
              offset: this.offset,
              indent: this.indent,
              start: this.sourceToken,
              items: [],
              end: []
            };
          case "seq-item-ind":
            return {
              type: "block-seq",
              offset: this.offset,
              indent: this.indent,
              items: [{ start: [this.sourceToken] }]
            };
          case "explicit-key-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            start.push(this.sourceToken);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, explicitKey: true }]
            };
          }
          case "map-value-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, key: null, sep: [this.sourceToken] }]
            };
          }
        }
        return null;
      }
      atIndentedComment(start, indent) {
        if (this.type !== "comment")
          return false;
        if (this.indent <= indent)
          return false;
        return start.every((st) => st.type === "newline" || st.type === "space");
      }
      *documentEnd(docEnd) {
        if (this.type !== "doc-mode") {
          if (docEnd.end)
            docEnd.end.push(this.sourceToken);
          else
            docEnd.end = [this.sourceToken];
          if (this.type === "newline")
            yield* this.pop();
        }
      }
      *lineEnd(token) {
        switch (this.type) {
          case "comma":
          case "doc-start":
          case "doc-end":
          case "flow-seq-end":
          case "flow-map-end":
          case "map-value-ind":
            yield* this.pop();
            yield* this.step();
            break;
          case "newline":
            this.onKeyLine = false;
          // fallthrough
          case "space":
          case "comment":
          default:
            if (token.end)
              token.end.push(this.sourceToken);
            else
              token.end = [this.sourceToken];
            if (this.type === "newline")
              yield* this.pop();
        }
      }
    };
    exports.Parser = Parser;
  }
});

// node_modules/yaml/dist/public-api.js
var require_public_api = __commonJS({
  "node_modules/yaml/dist/public-api.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var errors = require_errors();
    var log = require_log();
    var identity = require_identity();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    function parseOptions(options) {
      const prettyErrors = options.prettyErrors !== false;
      const lineCounter$1 = options.lineCounter || prettyErrors && new lineCounter.LineCounter() || null;
      return { lineCounter: lineCounter$1, prettyErrors };
    }
    function parseAllDocuments(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      const docs = Array.from(composer$1.compose(parser$1.parse(source)));
      if (prettyErrors && lineCounter2)
        for (const doc of docs) {
          doc.errors.forEach(errors.prettifyError(source, lineCounter2));
          doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
        }
      if (docs.length > 0)
        return docs;
      return Object.assign([], { empty: true }, composer$1.streamInfo());
    }
    function parseDocument(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      let doc = null;
      for (const _doc of composer$1.compose(parser$1.parse(source), true, source.length)) {
        if (!doc)
          doc = _doc;
        else if (doc.options.logLevel !== "silent") {
          doc.errors.push(new errors.YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
          break;
        }
      }
      if (prettyErrors && lineCounter2) {
        doc.errors.forEach(errors.prettifyError(source, lineCounter2));
        doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
      }
      return doc;
    }
    function parse8(src, reviver, options) {
      let _reviver = void 0;
      if (typeof reviver === "function") {
        _reviver = reviver;
      } else if (options === void 0 && reviver && typeof reviver === "object") {
        options = reviver;
      }
      const doc = parseDocument(src, options);
      if (!doc)
        return null;
      doc.warnings.forEach((warning) => log.warn(doc.options.logLevel, warning));
      if (doc.errors.length > 0) {
        if (doc.options.logLevel !== "silent")
          throw doc.errors[0];
        else
          doc.errors = [];
      }
      return doc.toJS(Object.assign({ reviver: _reviver }, options));
    }
    function stringify6(value, replacer, options) {
      let _replacer = null;
      if (typeof replacer === "function" || Array.isArray(replacer)) {
        _replacer = replacer;
      } else if (options === void 0 && replacer) {
        options = replacer;
      }
      if (typeof options === "string")
        options = options.length;
      if (typeof options === "number") {
        const indent = Math.round(options);
        options = indent < 1 ? void 0 : indent > 8 ? { indent: 8 } : { indent };
      }
      if (value === void 0) {
        const { keepUndefined } = options ?? replacer ?? {};
        if (!keepUndefined)
          return void 0;
      }
      if (identity.isDocument(value) && !_replacer)
        return value.toString(options);
      return new Document.Document(value, _replacer, options).toString(options);
    }
    exports.parse = parse8;
    exports.parseAllDocuments = parseAllDocuments;
    exports.parseDocument = parseDocument;
    exports.stringify = stringify6;
  }
});

// node_modules/yaml/dist/index.js
var require_dist = __commonJS({
  "node_modules/yaml/dist/index.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var Schema = require_Schema();
    var errors = require_errors();
    var Alias = require_Alias();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var cst = require_cst();
    var lexer = require_lexer();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    var publicApi = require_public_api();
    var visit = require_visit();
    exports.Composer = composer.Composer;
    exports.Document = Document.Document;
    exports.Schema = Schema.Schema;
    exports.YAMLError = errors.YAMLError;
    exports.YAMLParseError = errors.YAMLParseError;
    exports.YAMLWarning = errors.YAMLWarning;
    exports.Alias = Alias.Alias;
    exports.isAlias = identity.isAlias;
    exports.isCollection = identity.isCollection;
    exports.isDocument = identity.isDocument;
    exports.isMap = identity.isMap;
    exports.isNode = identity.isNode;
    exports.isPair = identity.isPair;
    exports.isScalar = identity.isScalar;
    exports.isSeq = identity.isSeq;
    exports.Pair = Pair.Pair;
    exports.Scalar = Scalar.Scalar;
    exports.YAMLMap = YAMLMap.YAMLMap;
    exports.YAMLSeq = YAMLSeq.YAMLSeq;
    exports.CST = cst;
    exports.Lexer = lexer.Lexer;
    exports.LineCounter = lineCounter.LineCounter;
    exports.Parser = parser.Parser;
    exports.parse = publicApi.parse;
    exports.parseAllDocuments = publicApi.parseAllDocuments;
    exports.parseDocument = publicApi.parseDocument;
    exports.stringify = publicApi.stringify;
    exports.visit = visit.visit;
    exports.visitAsync = visit.visitAsync;
  }
});

// packages/cli/src/cli.ts
import os4 from "node:os";
import path26 from "node:path";
import { spawn as spawn2 } from "node:child_process";
import fs28 from "node:fs/promises";

// node_modules/@clack/core/dist/index.mjs
import { styleText } from "node:util";
import { stdout, stdin } from "node:process";
import f__default from "node:readline";

// node_modules/fast-string-truncated-width/dist/utils.js
var getCodePointsLength = /* @__PURE__ */ (() => {
  const SURROGATE_PAIR_RE = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
  return (input) => {
    let surrogatePairsNr = 0;
    SURROGATE_PAIR_RE.lastIndex = 0;
    while (SURROGATE_PAIR_RE.test(input)) {
      surrogatePairsNr += 1;
    }
    return input.length - surrogatePairsNr;
  };
})();
var isFullWidth = (x) => {
  return x === 12288 || x >= 65281 && x <= 65376 || x >= 65504 && x <= 65510;
};
var isWideNotCJKTNotEmoji = (x) => {
  return x === 8987 || x === 9001 || x >= 12272 && x <= 12287 || x >= 12289 && x <= 12350 || x >= 12441 && x <= 12543 || x >= 12549 && x <= 12591 || x >= 12593 && x <= 12686 || x >= 12688 && x <= 12771 || x >= 12783 && x <= 12830 || x >= 12832 && x <= 12871 || x >= 12880 && x <= 19903 || x >= 65040 && x <= 65049 || x >= 65072 && x <= 65106 || x >= 65108 && x <= 65126 || x >= 65128 && x <= 65131 || x >= 127488 && x <= 127490 || x >= 127504 && x <= 127547 || x >= 127552 && x <= 127560 || x >= 131072 && x <= 196605 || x >= 196608 && x <= 262141;
};

// node_modules/fast-string-truncated-width/dist/index.js
var ANSI_RE = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]|\u001b\]8;[^;]*;.*?(?:\u0007|\u001b\u005c)/y;
var CONTROL_RE = /[\x00-\x08\x0A-\x1F\x7F-\x9F]{1,1000}/y;
var CJKT_WIDE_RE = /(?:(?![\uFF61-\uFF9F\uFF00-\uFFEF])[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Tangut}]){1,1000}/yu;
var TAB_RE = /\t{1,1000}/y;
var EMOJI_RE = new RegExp("[\\u{1F1E6}-\\u{1F1FF}]{2}|\\u{1F3F4}[\\u{E0061}-\\u{E007A}]{2}[\\u{E0030}-\\u{E0039}\\u{E0061}-\\u{E007A}]{1,3}\\u{E007F}|(?:\\p{Emoji}\\uFE0F\\u20E3?|\\p{Emoji_Modifier_Base}\\p{Emoji_Modifier}?|\\p{Emoji_Presentation})(?:\\u200D(?:\\p{Emoji_Modifier_Base}\\p{Emoji_Modifier}?|\\p{Emoji_Presentation}|\\p{Emoji}\\uFE0F\\u20E3?))*", "yu");
var LATIN_RE = /(?:[\x20-\x7E\xA0-\xFF](?!\uFE0F)){1,1000}/y;
var MODIFIER_RE = new RegExp("\\p{M}+", "gu");
var NO_TRUNCATION = { limit: Infinity, ellipsis: "" };
var getStringTruncatedWidth = (input, truncationOptions = {}, widthOptions = {}) => {
  const LIMIT = truncationOptions.limit ?? Infinity;
  const ELLIPSIS = truncationOptions.ellipsis ?? "";
  const ELLIPSIS_WIDTH = truncationOptions?.ellipsisWidth ?? (ELLIPSIS ? getStringTruncatedWidth(ELLIPSIS, NO_TRUNCATION, widthOptions).width : 0);
  const ANSI_WIDTH = 0;
  const CONTROL_WIDTH = widthOptions.controlWidth ?? 0;
  const TAB_WIDTH = widthOptions.tabWidth ?? 8;
  const EMOJI_WIDTH = widthOptions.emojiWidth ?? 2;
  const FULL_WIDTH_WIDTH = 2;
  const REGULAR_WIDTH = widthOptions.regularWidth ?? 1;
  const WIDE_WIDTH = widthOptions.wideWidth ?? FULL_WIDTH_WIDTH;
  const PARSE_BLOCKS = [
    [LATIN_RE, REGULAR_WIDTH],
    [ANSI_RE, ANSI_WIDTH],
    [CONTROL_RE, CONTROL_WIDTH],
    [TAB_RE, TAB_WIDTH],
    [EMOJI_RE, EMOJI_WIDTH],
    [CJKT_WIDE_RE, WIDE_WIDTH]
  ];
  let indexPrev = 0;
  let index = 0;
  let length = input.length;
  let lengthExtra = 0;
  let truncationEnabled = false;
  let truncationIndex = length;
  let truncationLimit = Math.max(0, LIMIT - ELLIPSIS_WIDTH);
  let unmatchedStart = 0;
  let unmatchedEnd = 0;
  let width = 0;
  let widthExtra = 0;
  outer: while (true) {
    if (unmatchedEnd > unmatchedStart || index >= length && index > indexPrev) {
      const unmatched = input.slice(unmatchedStart, unmatchedEnd) || input.slice(indexPrev, index);
      lengthExtra = 0;
      for (const char of unmatched.replaceAll(MODIFIER_RE, "")) {
        const codePoint = char.codePointAt(0) || 0;
        if (isFullWidth(codePoint)) {
          widthExtra = FULL_WIDTH_WIDTH;
        } else if (isWideNotCJKTNotEmoji(codePoint)) {
          widthExtra = WIDE_WIDTH;
        } else {
          widthExtra = REGULAR_WIDTH;
        }
        if (width + widthExtra > truncationLimit) {
          truncationIndex = Math.min(truncationIndex, Math.max(unmatchedStart, indexPrev) + lengthExtra);
        }
        if (width + widthExtra > LIMIT) {
          truncationEnabled = true;
          break outer;
        }
        lengthExtra += char.length;
        width += widthExtra;
      }
      unmatchedStart = unmatchedEnd = 0;
    }
    if (index >= length) {
      break outer;
    }
    for (let i2 = 0, l = PARSE_BLOCKS.length; i2 < l; i2++) {
      const [BLOCK_RE, BLOCK_WIDTH] = PARSE_BLOCKS[i2];
      BLOCK_RE.lastIndex = index;
      if (BLOCK_RE.test(input)) {
        lengthExtra = BLOCK_RE === CJKT_WIDE_RE ? getCodePointsLength(input.slice(index, BLOCK_RE.lastIndex)) : BLOCK_RE === EMOJI_RE ? 1 : BLOCK_RE.lastIndex - index;
        widthExtra = lengthExtra * BLOCK_WIDTH;
        if (width + widthExtra > truncationLimit) {
          truncationIndex = Math.min(truncationIndex, index + Math.floor((truncationLimit - width) / BLOCK_WIDTH));
        }
        if (width + widthExtra > LIMIT) {
          truncationEnabled = true;
          break outer;
        }
        width += widthExtra;
        unmatchedStart = indexPrev;
        unmatchedEnd = index;
        index = indexPrev = BLOCK_RE.lastIndex;
        continue outer;
      }
    }
    index += 1;
  }
  return {
    width: truncationEnabled ? truncationLimit : width,
    index: truncationEnabled ? truncationIndex : length,
    truncated: truncationEnabled,
    ellipsed: truncationEnabled && LIMIT >= ELLIPSIS_WIDTH
  };
};
var dist_default = getStringTruncatedWidth;

// node_modules/fast-string-width/dist/index.js
var NO_TRUNCATION2 = {
  limit: Infinity,
  ellipsis: "",
  ellipsisWidth: 0
};
var fastStringWidth = (input, options = {}) => {
  return dist_default(input, NO_TRUNCATION2, options).width;
};
var dist_default2 = fastStringWidth;

// node_modules/fast-wrap-ansi/lib/main.js
var ESC = "\x1B";
var CSI = "\x9B";
var END_CODE = 39;
var ANSI_ESCAPE_BELL = "\x07";
var ANSI_CSI = "[";
var ANSI_OSC = "]";
var ANSI_SGR_TERMINATOR = "m";
var ANSI_ESCAPE_LINK = `${ANSI_OSC}8;;`;
var GROUP_REGEX = new RegExp(`(?:\\${ANSI_CSI}(?<code>\\d+)m|\\${ANSI_ESCAPE_LINK}(?<uri>.*)${ANSI_ESCAPE_BELL})`, "y");
var getClosingCode = (openingCode) => {
  if (openingCode >= 30 && openingCode <= 37)
    return 39;
  if (openingCode >= 90 && openingCode <= 97)
    return 39;
  if (openingCode >= 40 && openingCode <= 47)
    return 49;
  if (openingCode >= 100 && openingCode <= 107)
    return 49;
  if (openingCode === 1 || openingCode === 2)
    return 22;
  if (openingCode === 3)
    return 23;
  if (openingCode === 4)
    return 24;
  if (openingCode === 7)
    return 27;
  if (openingCode === 8)
    return 28;
  if (openingCode === 9)
    return 29;
  if (openingCode === 0)
    return 0;
  return void 0;
};
var wrapAnsiCode = (code) => `${ESC}${ANSI_CSI}${code}${ANSI_SGR_TERMINATOR}`;
var wrapAnsiHyperlink = (url) => `${ESC}${ANSI_ESCAPE_LINK}${url}${ANSI_ESCAPE_BELL}`;
var wrapWord = (rows, word, columns) => {
  const characters = word[Symbol.iterator]();
  let isInsideEscape = false;
  let isInsideLinkEscape = false;
  let lastRow = rows.at(-1);
  let visible = lastRow === void 0 ? 0 : dist_default2(lastRow);
  let currentCharacter = characters.next();
  let nextCharacter = characters.next();
  let rawCharacterIndex = 0;
  while (!currentCharacter.done) {
    const character = currentCharacter.value;
    const characterLength = dist_default2(character);
    if (visible + characterLength <= columns) {
      rows[rows.length - 1] += character;
    } else {
      rows.push(character);
      visible = 0;
    }
    if (character === ESC || character === CSI) {
      isInsideEscape = true;
      isInsideLinkEscape = word.startsWith(ANSI_ESCAPE_LINK, rawCharacterIndex + 1);
    }
    if (isInsideEscape) {
      if (isInsideLinkEscape) {
        if (character === ANSI_ESCAPE_BELL) {
          isInsideEscape = false;
          isInsideLinkEscape = false;
        }
      } else if (character === ANSI_SGR_TERMINATOR) {
        isInsideEscape = false;
      }
    } else {
      visible += characterLength;
      if (visible === columns && !nextCharacter.done) {
        rows.push("");
        visible = 0;
      }
    }
    currentCharacter = nextCharacter;
    nextCharacter = characters.next();
    rawCharacterIndex += character.length;
  }
  lastRow = rows.at(-1);
  if (!visible && lastRow !== void 0 && lastRow.length && rows.length > 1) {
    rows[rows.length - 2] += rows.pop();
  }
};
var stringVisibleTrimSpacesRight = (string) => {
  const words = string.split(" ");
  let last = words.length;
  while (last) {
    if (dist_default2(words[last - 1])) {
      break;
    }
    last--;
  }
  if (last === words.length) {
    return string;
  }
  return words.slice(0, last).join(" ") + words.slice(last).join("");
};
var exec = (string, columns, options = {}) => {
  if (options.trim !== false && string.trim() === "") {
    return "";
  }
  let returnValue = "";
  let escapeCode;
  let escapeUrl;
  const words = string.split(" ");
  let rows = [""];
  let rowLength = 0;
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    if (options.trim !== false) {
      const row = rows.at(-1) ?? "";
      const trimmed = row.trimStart();
      if (row.length !== trimmed.length) {
        rows[rows.length - 1] = trimmed;
        rowLength = dist_default2(trimmed);
      }
    }
    if (index !== 0) {
      if (rowLength >= columns && (options.wordWrap === false || options.trim === false)) {
        rows.push("");
        rowLength = 0;
      }
      if (rowLength || options.trim === false) {
        rows[rows.length - 1] += " ";
        rowLength++;
      }
    }
    const wordLength = dist_default2(word);
    if (options.hard && wordLength > columns) {
      const remainingColumns = columns - rowLength;
      const breaksStartingThisLine = 1 + Math.floor((wordLength - remainingColumns - 1) / columns);
      const breaksStartingNextLine = Math.floor((wordLength - 1) / columns);
      if (breaksStartingNextLine < breaksStartingThisLine) {
        rows.push("");
      }
      wrapWord(rows, word, columns);
      rowLength = dist_default2(rows.at(-1) ?? "");
      continue;
    }
    if (rowLength + wordLength > columns && rowLength && wordLength) {
      if (options.wordWrap === false && rowLength < columns) {
        wrapWord(rows, word, columns);
        rowLength = dist_default2(rows.at(-1) ?? "");
        continue;
      }
      rows.push("");
      rowLength = 0;
    }
    if (rowLength + wordLength > columns && options.wordWrap === false) {
      wrapWord(rows, word, columns);
      rowLength = dist_default2(rows.at(-1) ?? "");
      continue;
    }
    rows[rows.length - 1] += word;
    rowLength += wordLength;
  }
  if (options.trim !== false) {
    rows = rows.map((row) => stringVisibleTrimSpacesRight(row));
  }
  const preString = rows.join("\n");
  let inSurrogate = false;
  for (let i2 = 0; i2 < preString.length; i2++) {
    const character = preString[i2];
    returnValue += character;
    if (!inSurrogate) {
      inSurrogate = character >= "\uD800" && character <= "\uDBFF";
      if (inSurrogate) {
        continue;
      }
    } else {
      inSurrogate = false;
    }
    if (character === ESC || character === CSI) {
      GROUP_REGEX.lastIndex = i2 + 1;
      const groupsResult = GROUP_REGEX.exec(preString);
      const groups = groupsResult?.groups;
      if (groups?.code !== void 0) {
        const code = Number.parseFloat(groups.code);
        escapeCode = code === END_CODE ? void 0 : code;
      } else if (groups?.uri !== void 0) {
        escapeUrl = groups.uri.length === 0 ? void 0 : groups.uri;
      }
    }
    if (preString[i2 + 1] === "\n") {
      if (escapeUrl) {
        returnValue += wrapAnsiHyperlink("");
      }
      const closingCode = escapeCode ? getClosingCode(escapeCode) : void 0;
      if (escapeCode && closingCode) {
        returnValue += wrapAnsiCode(closingCode);
      }
    } else if (character === "\n") {
      if (escapeCode && getClosingCode(escapeCode)) {
        returnValue += wrapAnsiCode(escapeCode);
      }
      if (escapeUrl) {
        returnValue += wrapAnsiHyperlink(escapeUrl);
      }
    }
  }
  return returnValue;
};
var CRLF_OR_LF = /\r?\n/;
function wrapAnsi(string, columns, options) {
  return String(string).normalize().split(CRLF_OR_LF).map((line) => exec(line, columns, options)).join("\n");
}

// node_modules/sisteransi/dist/index.js
var ESC2 = "\x1B";
var CSI2 = `${ESC2}[`;
var cursor = {
  to(x, y) {
    if (!y)
      return `${CSI2}${x + 1}G`;
    return `${CSI2}${y + 1};${x + 1}H`;
  },
  move(x, y) {
    let ret = "";
    if (x < 0)
      ret += `${CSI2}${-x}D`;
    else if (x > 0)
      ret += `${CSI2}${x}C`;
    if (y < 0)
      ret += `${CSI2}${-y}A`;
    else if (y > 0)
      ret += `${CSI2}${y}B`;
    return ret;
  },
  up: (count = 1) => `${CSI2}${count}A`,
  down: (count = 1) => `${CSI2}${count}B`,
  forward: (count = 1) => `${CSI2}${count}C`,
  backward: (count = 1) => `${CSI2}${count}D`,
  nextLine: (count = 1) => `${CSI2}E`.repeat(count),
  prevLine: (count = 1) => `${CSI2}F`.repeat(count),
  left: `${CSI2}G`,
  hide: `${CSI2}?25l`,
  show: `${CSI2}?25h`,
  save: `${ESC2}7`,
  restore: `${ESC2}8`
};
var erase = {
  screen: `${CSI2}2J`,
  up: (count = 1) => `${CSI2}1J`.repeat(count),
  down: (count = 1) => `${CSI2}J`.repeat(count),
  line: `${CSI2}2K`,
  lineEnd: `${CSI2}K`,
  lineStart: `${CSI2}1K`,
  lines(count) {
    let clear2 = "";
    for (let i2 = 0; i2 < count; i2++)
      clear2 += this.line + (i2 < count - 1 ? cursor.up() : "");
    if (count)
      clear2 += cursor.left;
    return clear2;
  }
};
var clear = {
  screen: `${ESC2}c`
};

// node_modules/@clack/core/dist/index.mjs
function findCursor(o, s, l) {
  if (!l.some((r2) => !r2.disabled))
    return o;
  const t2 = o + s, n3 = Math.max(l.length - 1, 0), e = t2 < 0 ? n3 : t2 > n3 ? 0 : t2;
  return l[e]?.disabled ? findCursor(e, s < 0 ? -1 : 1, l) : e;
}
var a$1 = ["up", "down", "left", "right", "space", "enter", "cancel"];
var t = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];
var settings = {
  actions: new Set(a$1),
  aliases: /* @__PURE__ */ new Map([
    // vim support
    ["k", "up"],
    ["j", "down"],
    ["h", "left"],
    ["l", "right"],
    ["", "cancel"],
    // opinionated defaults!
    ["escape", "cancel"]
  ]),
  messages: {
    cancel: "Canceled",
    error: "Something went wrong"
  },
  withGuide: true,
  accessible: void 0,
  date: {
    monthNames: [...t],
    messages: {
      required: "Please enter a valid date",
      invalidMonth: "There are only 12 months in a year",
      invalidDay: (n3, e) => `There are only ${n3} days in ${e}`,
      afterMin: (n3) => `Date must be on or after ${n3.toISOString().slice(0, 10)}`,
      beforeMax: (n3) => `Date must be on or before ${n3.toISOString().slice(0, 10)}`
    }
  }
};
function isAccessible(n3) {
  if (n3 !== void 0) return n3;
  if (settings.accessible !== void 0) return settings.accessible;
  const e = process.env.ACCESSIBLE;
  return e !== void 0 && e !== "" && e !== "0" && e !== "false";
}
function isActionKey(n3, e) {
  if (typeof n3 == "string")
    return settings.aliases.get(n3) === e;
  for (const s of n3)
    if (s !== void 0 && isActionKey(s, e))
      return true;
  return false;
}
function diffLines(i2, s) {
  if (i2 === s) return;
  const e = i2.split(`
`), t2 = s.split(`
`), r2 = Math.max(e.length, t2.length), f = [];
  for (let n3 = 0; n3 < r2; n3++)
    e[n3] !== t2[n3] && f.push(n3);
  return {
    lines: f,
    numLinesBefore: e.length,
    numLinesAfter: t2.length,
    numLines: r2
  };
}
var R = globalThis.process.platform.startsWith("win");
var CANCEL_SYMBOL = Symbol("clack:cancel");
function isCancel(e) {
  return e === CANCEL_SYMBOL;
}
function setRawMode(e, r2) {
  const o = e;
  o.isTTY && o.setRawMode(r2);
}
var getColumns = (e) => "columns" in e && typeof e.columns == "number" ? e.columns : 80;
var getRows = (e) => "rows" in e && typeof e.rows == "number" ? e.rows : 20;
function wrapTextWithPrefix(e, r2, o, n3 = o, s = o, t2) {
  const l = getColumns(e ?? stdout), i2 = dist_default2(o);
  return wrapAnsi(r2, l - i2, {
    hard: true,
    trim: false
  }).split(`
`).map((c3, a2, g) => {
    const m2 = t2 ? t2(c3, a2) : c3;
    return a2 === 0 ? `${n3}${m2}` : a2 === g.length - 1 ? `${s}${m2}` : `${o}${m2}`;
  }).join(`
`);
}
function runValidation(e, a2) {
  if ("~standard" in e) {
    const n3 = e["~standard"].validate(a2);
    return n3 instanceof Promise ? n3.then((r2) => r2.issues?.at(0)?.message) : n3.issues?.at(0)?.message;
  }
  return e(a2);
}
var C$1 = class C {
  input;
  output;
  _abortSignal;
  rl;
  opts;
  _render;
  _track = false;
  _prevFrame = "";
  _subscribers = /* @__PURE__ */ new Map();
  _cursor = 0;
  state = "initial";
  error = "";
  value;
  userInput = "";
  /**
   * Whether accessible (static, screen-reader friendly) output is enabled for
   * this prompt, resolved from the `accessible` option, the global setting,
   * and the `ACCESSIBLE` env var.
   */
  get accessible() {
    return isAccessible(this.opts.accessible);
  }
  constructor(t2, e = true) {
    const { input: i2 = stdin, output: s = stdout, render: r2, signal: n3, ...o } = t2;
    this.opts = o, this.onKeypress = this.onKeypress.bind(this), this.close = this.close.bind(this), this.render = this.render.bind(this), this._render = r2.bind(this), this._track = e, this._abortSignal = n3, this.input = i2, this.output = s;
  }
  /**
   * Unsubscribe all listeners
   */
  unsubscribe() {
    this._subscribers.clear();
  }
  /**
   * Set a subscriber with opts
   * @param event - The event name
   */
  setSubscriber(t2, e) {
    const i2 = this._subscribers.get(t2) ?? [];
    i2.push(e), this._subscribers.set(t2, i2);
  }
  /**
   * Subscribe to an event
   * @param event - The event name
   * @param cb - The callback
   */
  on(t2, e) {
    this.setSubscriber(t2, { cb: e });
  }
  /**
   * Subscribe to an event once
   * @param event - The event name
   * @param cb - The callback
   */
  once(t2, e) {
    this.setSubscriber(t2, { cb: e, once: true });
  }
  /**
   * Emit an event with data
   * @param event - The event name
   * @param data - The data to pass to the callback
   */
  emit(t2, ...e) {
    const i2 = this._subscribers.get(t2) ?? [], s = [];
    for (const r2 of i2)
      r2.cb(...e), r2.once && s.push(() => i2.splice(i2.indexOf(r2), 1));
    for (const r2 of s)
      r2();
  }
  prompt() {
    return new Promise((t2) => {
      if (this._abortSignal) {
        if (this._abortSignal.aborted)
          return this.state = "cancel", this.close(), t2(CANCEL_SYMBOL);
        this._abortSignal.addEventListener(
          "abort",
          () => {
            this.state = "cancel", this.close();
          },
          { once: true }
        );
      }
      this.rl = f__default.createInterface({
        input: this.input,
        tabSize: 2,
        prompt: "",
        escapeCodeTimeout: 50,
        terminal: true
      }), this.rl.prompt(), this.opts.initialUserInput !== void 0 && this._setUserInput(this.opts.initialUserInput, true), this.input.on("keypress", this.onKeypress), setRawMode(this.input, true), this.output.on("resize", this.render), this.render(), this.once("submit", () => {
        this.output.write(cursor.show), this.output.off("resize", this.render), setRawMode(this.input, false), t2(this.value);
      }), this.once("cancel", () => {
        this.output.write(cursor.show), this.output.off("resize", this.render), setRawMode(this.input, false), t2(CANCEL_SYMBOL);
      });
    });
  }
  _isActionKey(t2, e) {
    return t2 === "	";
  }
  _shouldSubmit(t2, e) {
    return true;
  }
  _setValue(t2) {
    this.value = t2, this.emit("value", this.value);
  }
  _setUserInput(t2, e) {
    this.userInput = t2 ?? "", this.emit("userInput", this.userInput), e && this._track && this.rl && (this.rl.write(this.userInput), this._cursor = this.rl.cursor);
  }
  _clearUserInput() {
    this.rl?.write(null, { ctrl: true, name: "u" }), this._setUserInput("");
  }
  async onKeypress(t2, e) {
    if (this.state !== "validating") {
      if (this._track && e.name !== "return" && (e.name && this._isActionKey(t2, e) && this.rl?.write(null, { ctrl: true, name: "h" }), this._cursor = this.rl?.cursor ?? 0, this._setUserInput(this.rl?.line)), this.state === "error" && (this.state = "active"), e?.name && (!this._track && settings.aliases.has(e.name) && this.emit("cursor", settings.aliases.get(e.name)), settings.actions.has(e.name) && this.emit("cursor", e.name)), t2 && (t2.toLowerCase() === "y" || t2.toLowerCase() === "n") && this.emit("confirm", t2.toLowerCase() === "y"), this.emit("key", t2, e), e?.name === "return" && this._shouldSubmit(t2, e)) {
        if (this.opts.validate) {
          const i2 = runValidation(this.opts.validate, this.value);
          let s;
          i2 instanceof Promise ? (this.state = "validating", this.render(), s = await i2) : s = i2, s && (this.error = s instanceof Error ? s.message : s, this.state = "error", this.rl?.write(this.userInput));
        }
        this.state !== "error" && (this.state = "submit");
      }
      isActionKey([t2, e?.name, e?.sequence], "cancel") && (this.state = "cancel"), (this.state === "submit" || this.state === "cancel") && this.emit("finalize"), this.render(), (this.state === "submit" || this.state === "cancel") && this.close();
    }
  }
  close() {
    this.input.unpipe(), this.input.removeListener("keypress", this.onKeypress), this.output.write(`
`), setRawMode(this.input, false), this.rl?.close(), this.rl = void 0, this.emit(`${this.state}`, this.value), this.unsubscribe();
  }
  restoreCursor() {
    const t2 = wrapAnsi(this._prevFrame, getColumns(this.output), { hard: true, trim: false }).split(`
`).length - 1;
    this.output.write(cursor.move(-999, t2 * -1));
  }
  render() {
    const t2 = wrapAnsi(this._render(this) ?? "", getColumns(this.output), {
      hard: true,
      trim: false
    });
    if (t2 !== this._prevFrame) {
      if (this.state === "initial")
        this.output.write(cursor.hide);
      else {
        const e = diffLines(this._prevFrame, t2), i2 = getRows(this.output);
        if (this.restoreCursor(), e) {
          const s = Math.max(0, e.numLinesAfter - i2), r2 = Math.max(0, e.numLinesBefore - i2);
          let n3 = e.lines.find((o) => o >= s);
          if (n3 === void 0) {
            this._prevFrame = t2;
            return;
          }
          if (e.lines.length === 1) {
            this.output.write(cursor.move(0, n3 - r2)), this.output.write(erase.lines(1));
            const o = t2.split(`
`);
            this.output.write(o[n3]), this._prevFrame = t2, this.output.write(cursor.move(0, o.length - n3 - 1));
            return;
          } else if (e.lines.length > 1) {
            if (s < r2)
              n3 = s;
            else {
              const h2 = n3 - r2;
              h2 > 0 && this.output.write(cursor.move(0, h2));
            }
            this.output.write(erase.down());
            const m2 = t2.split(`
`).slice(n3);
            this.output.write(m2.join(`
`)), this._prevFrame = t2;
            return;
          }
        }
        this.output.write(erase.down());
      }
      this.output.write(t2), this.state === "initial" && (this.state = "active"), this._prevFrame = t2;
    }
  }
};
var r = class extends C$1 {
  get cursor() {
    return this.value ? 0 : 1;
  }
  get _value() {
    return this.cursor === 0;
  }
  constructor(t2) {
    super(t2, false), this.value = !!t2.initialValue, this.on("userInput", () => {
      this.value = this._value;
    }), this.on("confirm", (i2) => {
      this.output.write(cursor.move(0, -1)), this.value = i2, this.state = "submit", this.close();
    }), this.on("cursor", () => {
      this.value = !this.value;
    });
  }
};
var a = class extends C$1 {
  options;
  cursor = 0;
  get _value() {
    return this.options[this.cursor]?.value;
  }
  get _enabledOptions() {
    return this.options.filter((e) => e.disabled !== true);
  }
  toggleAll() {
    const e = this._enabledOptions, i2 = this.value !== void 0 && this.value.length === e.length;
    this.value = i2 ? [] : e.map((t2) => t2.value);
  }
  toggleInvert() {
    const e = this.value;
    if (!e)
      return;
    const i2 = this._enabledOptions.filter((t2) => !e.includes(t2.value));
    this.value = i2.map((t2) => t2.value);
  }
  toggleValue() {
    this.value === void 0 && (this.value = []);
    const e = this.value.includes(this._value);
    this.value = e ? this.value.filter((i2) => i2 !== this._value) : [...this.value, this._value];
  }
  constructor(e) {
    super(e, false), this.options = e.options, this.value = [...e.initialValues ?? []];
    const i2 = Math.max(
      this.options.findIndex(({ value: t2 }) => t2 === e.cursorAt),
      0
    );
    this.cursor = this.options[i2]?.disabled ? findCursor(i2, 1, this.options) : i2, this.on("key", (t2, s) => {
      s.name === "a" && this.toggleAll(), s.name === "i" && this.toggleInvert(), s.name === void 0 && t2 === "\u3000" && this.toggleValue();
    }), this.on("cursor", (t2) => {
      switch (t2) {
        case "left":
        case "up":
          this.cursor = findCursor(this.cursor, -1, this.options);
          break;
        case "down":
        case "right":
          this.cursor = findCursor(this.cursor, 1, this.options);
          break;
        case "space":
          this.toggleValue();
          break;
      }
    });
  }
};
var n$1 = class n extends C$1 {
  options;
  cursor = 0;
  get _selectedValue() {
    return this.options[this.cursor];
  }
  changeValue() {
    const e = this._selectedValue;
    this.value = e === void 0 ? void 0 : e.value;
  }
  constructor(e) {
    super(e, false), this.options = e.options;
    const o = this.options.findIndex(({ value: s }) => s === e.initialValue), t2 = o === -1 ? 0 : o;
    this.cursor = this.options[t2]?.disabled ? findCursor(t2, 1, this.options) : t2, this.changeValue(), this.on("cursor", (s) => {
      switch (s) {
        case "left":
        case "up":
          this.cursor = findCursor(this.cursor, -1, this.options);
          break;
        case "down":
        case "right":
          this.cursor = findCursor(this.cursor, 1, this.options);
          break;
      }
      this.changeValue();
    });
  }
};
var n2 = class extends C$1 {
  get userInputWithCursor() {
    if (this.state === "submit")
      return this.userInput;
    const t2 = this.userInput;
    if (this.cursor >= t2.length)
      return `${this.userInput}\u2588`;
    const r2 = t2.slice(0, this.cursor), s = t2.slice(this.cursor, this.cursor + 1), e = t2.slice(this.cursor + 1);
    return `${r2}${styleText("inverse", s)}${e}`;
  }
  get cursor() {
    return this._cursor;
  }
  constructor(t2) {
    super({
      ...t2,
      initialUserInput: t2.initialUserInput ?? t2.initialValue
    }), this.on("userInput", (r2) => {
      this._setValue(r2);
    }), this.on("finalize", () => {
      this.value || (this.value = t2.defaultValue), this.value === void 0 && (this.value = "");
    });
  }
};

// node_modules/@clack/prompts/dist/index.mjs
import { styleText as styleText2, stripVTControlCharacters } from "node:util";
import process$1 from "node:process";
function isUnicodeSupported() {
  if (process$1.platform !== "win32") {
    return process$1.env.TERM !== "linux";
  }
  return Boolean(process$1.env.CI) || Boolean(process$1.env.WT_SESSION) || Boolean(process$1.env.TERMINUS_SUBLIME) || process$1.env.ConEmuTask === "{cmd::Cmder}" || process$1.env.TERM_PROGRAM === "Terminus-Sublime" || process$1.env.TERM_PROGRAM === "vscode" || process$1.env.TERM === "xterm-256color" || process$1.env.TERM === "alacritty" || process$1.env.TERMINAL_EMULATOR === "JetBrains-JediTerm";
}
var unicode = isUnicodeSupported();
var unicodeOr = (e, o) => unicode ? e : o;
var S_STEP_ACTIVE = unicodeOr("\u25C6", "*");
var S_STEP_CANCEL = unicodeOr("\u25A0", "x");
var S_STEP_ERROR = unicodeOr("\u25B2", "x");
var S_STEP_SUBMIT = unicodeOr("\u25C7", "o");
var S_BAR_START = unicodeOr("\u250C", "T");
var S_BAR = unicodeOr("\u2502", "|");
var S_BAR_END = unicodeOr("\u2514", "\u2014");
var S_BAR_START_RIGHT = unicodeOr("\u2510", "T");
var S_BAR_END_RIGHT = unicodeOr("\u2518", "\u2014");
var S_RADIO_ACTIVE = unicodeOr("\u25CF", ">");
var S_RADIO_INACTIVE = unicodeOr("\u25CB", " ");
var S_CHECKBOX_ACTIVE = unicodeOr("\u25FB", "[\u2022]");
var S_CHECKBOX_SELECTED = unicodeOr("\u25FC", "[+]");
var S_CHECKBOX_INACTIVE = unicodeOr("\u25FB", "[ ]");
var S_PASSWORD_MASK = unicodeOr("\u25AA", "\u2022");
var S_BAR_H = unicodeOr("\u2500", "-");
var S_CORNER_TOP_RIGHT = unicodeOr("\u256E", "+");
var S_CONNECT_LEFT = unicodeOr("\u251C", "+");
var S_CORNER_BOTTOM_RIGHT = unicodeOr("\u256F", "+");
var S_CORNER_BOTTOM_LEFT = unicodeOr("\u2570", "+");
var S_CORNER_TOP_LEFT = unicodeOr("\u256D", "+");
var S_INFO = unicodeOr("\u25CF", "\u2022");
var S_SUCCESS = unicodeOr("\u25C6", "*");
var S_WARN = unicodeOr("\u25B2", "!");
var S_ERROR = unicodeOr("\u25A0", "x");
var symbol = (e) => {
  switch (e) {
    case "initial":
    case "active":
      return styleText2("cyan", S_STEP_ACTIVE);
    case "cancel":
      return styleText2("red", S_STEP_CANCEL);
    case "error":
      return styleText2("yellow", S_STEP_ERROR);
    case "submit":
      return styleText2("green", S_STEP_SUBMIT);
    case "validating":
      return styleText2("dim", S_STEP_ACTIVE);
  }
};
var symbolBar = (e) => {
  switch (e) {
    case "initial":
    case "active":
      return styleText2("cyan", S_BAR);
    case "cancel":
      return styleText2("red", S_BAR);
    case "error":
      return styleText2("yellow", S_BAR);
    case "submit":
      return styleText2("green", S_BAR);
  }
};
function formatInstructionFooter(e, o, r2) {
  const s = r2 ? `${styleText2("cyan", S_BAR)}  ` : "", n3 = wrapTextWithPrefix(e, o.join(" \u2022 "), s).split(`
`);
  return r2 && n3.push(styleText2("cyan", S_BAR_END)), n3;
}
var E$1 = (l, e, w, p, b, C2 = false) => {
  let r2 = e, O = 0;
  if (C2)
    for (let i2 = p - 1; i2 >= w; i2--) {
      const m2 = l[i2];
      if (m2 && (r2 -= m2.length), O++, r2 <= b) break;
    }
  else
    for (let i2 = w; i2 < p; i2++) {
      const m2 = l[i2];
      if (m2 && (r2 -= m2.length), O++, r2 <= b) break;
    }
  return { lineCount: r2, removals: O };
};
var limitOptions = ({
  cursor: l,
  options: e,
  style: w,
  output: p = process.stdout,
  maxItems: b = Number.POSITIVE_INFINITY,
  columnPadding: C2 = 0,
  rowPadding: r2 = 4
}) => {
  const i2 = getColumns(p) - C2, m2 = getRows(p), M = styleText2("dim", "..."), v = Math.max(m2 - r2, 0), a2 = Math.max(Math.min(b, v), 5);
  let f = 0;
  l >= a2 - 3 && (f = Math.max(
    Math.min(l - a2 + 3, e.length - a2),
    0
  ));
  let d = a2 < e.length && f > 0, c3 = a2 < e.length && f + a2 < e.length;
  const I = Math.min(
    f + a2,
    e.length
  ), s = [];
  let g = 0;
  d && g++, c3 && g++;
  const T = f + (d ? 1 : 0), W = I - (c3 ? 1 : 0);
  for (let t2 = T; t2 < W; t2++) {
    const n3 = e[t2], o = n3 !== void 0 ? w(n3, t2 === l) : "", h2 = wrapAnsi(o, i2, {
      hard: true,
      trim: false
    }).split(`
`);
    s.push(h2), g += h2.length;
  }
  if (g > v) {
    let t2 = 0, n3 = 0, o = g;
    const h2 = l - T;
    let u3 = v;
    const L = () => E$1(s, o, 0, h2, u3), y = () => E$1(
      s,
      o,
      h2 + 1,
      s.length,
      u3,
      true
    );
    d ? ({ lineCount: o, removals: t2 } = L(), o > u3 && (c3 || (u3 -= 1), { lineCount: o, removals: n3 } = y())) : (c3 || (u3 -= 1), { lineCount: o, removals: n3 } = y(), o > u3 && (u3 -= 1, { lineCount: o, removals: t2 } = L())), t2 > 0 && (d = true, s.splice(0, t2)), n3 > 0 && (c3 = true, s.splice(s.length - n3, n3));
  }
  const x = [];
  d && x.push(M);
  for (const t2 of s)
    for (const n3 of t2)
      x.push(n3);
  return c3 && x.push(M), x;
};
var confirm = (e) => {
  const a2 = e.active ?? "Yes", o = e.inactive ?? "No";
  return new r({
    active: a2,
    inactive: o,
    signal: e.signal,
    input: e.input,
    output: e.output,
    initialValue: e.initialValue ?? true,
    render() {
      const i2 = e.withGuide ?? settings.withGuide, u3 = `${symbol(this.state)}  `, l = i2 ? `${styleText2("gray", S_BAR)}  ` : "", f = wrapTextWithPrefix(
        e.output,
        e.message,
        l,
        u3
      ), s = `${i2 ? `${styleText2("gray", S_BAR)}
` : ""}${f}
`, c3 = this.value ? a2 : o;
      switch (this.state) {
        case "submit": {
          const r2 = i2 ? `${styleText2("gray", S_BAR)}  ` : "";
          return `${s}${r2}${styleText2("dim", c3)}`;
        }
        case "cancel": {
          const r2 = i2 ? `${styleText2("gray", S_BAR)}  ` : "";
          return `${s}${r2}${styleText2(["strikethrough", "dim"], c3)}${i2 ? `
${styleText2("gray", S_BAR)}` : ""}`;
        }
        default: {
          const r2 = i2 ? `${styleText2("cyan", S_BAR)}  ` : "", g = i2 ? styleText2("cyan", S_BAR_END) : "";
          return `${s}${r2}${this.value ? `${styleText2("green", S_RADIO_ACTIVE)} ${a2}` : `${styleText2("dim", S_RADIO_INACTIVE)} ${styleText2("dim", a2)}`}${e.vertical ? i2 ? `
${styleText2("cyan", S_BAR)}  ` : `
` : ` ${styleText2("dim", "/")} `}${this.value ? `${styleText2("dim", S_RADIO_INACTIVE)} ${styleText2("dim", o)}` : `${styleText2("green", S_RADIO_ACTIVE)} ${o}`}
${g}
`;
        }
      }
    }
  }).prompt();
};
var MULTISELECT_INSTRUCTIONS = [
  `${styleText2("dim", "\u2191/\u2193")} to navigate`,
  `${styleText2("dim", "Space:")} select`,
  `${styleText2("dim", "Enter:")} confirm`
];
var m = (n3, u3) => n3.split(`
`).map((d) => u3(d)).join(`
`);
var multiselect = (n3) => {
  const u3 = (t2, a2) => {
    const r2 = t2.label ?? String(t2.value);
    return a2 === "disabled" ? `${styleText2("gray", S_CHECKBOX_INACTIVE)} ${m(r2, (o) => styleText2(["strikethrough", "gray"], o))}${t2.hint ? ` ${styleText2("dim", `(${t2.hint ?? "disabled"})`)}` : ""}` : a2 === "active" ? `${styleText2("cyan", S_CHECKBOX_ACTIVE)} ${r2}${t2.hint ? ` ${styleText2("dim", `(${t2.hint})`)}` : ""}` : a2 === "selected" ? `${styleText2("green", S_CHECKBOX_SELECTED)} ${m(r2, (o) => styleText2("dim", o))}${t2.hint ? ` ${styleText2("dim", `(${t2.hint})`)}` : ""}` : a2 === "cancelled" ? `${m(r2, (o) => styleText2(["strikethrough", "dim"], o))}` : a2 === "active-selected" ? `${styleText2("green", S_CHECKBOX_SELECTED)} ${r2}${t2.hint ? ` ${styleText2("dim", `(${t2.hint})`)}` : ""}` : a2 === "submitted" ? `${m(r2, (o) => styleText2("dim", o))}` : `${styleText2("dim", S_CHECKBOX_INACTIVE)} ${m(r2, (o) => styleText2("dim", o))}`;
  }, d = n3.required ?? true, x = n3.showInstructions ?? true;
  return new a({
    options: n3.options,
    signal: n3.signal,
    input: n3.input,
    output: n3.output,
    initialValues: n3.initialValues,
    required: d,
    cursorAt: n3.cursorAt,
    validate(t2) {
      if (d && (t2 === void 0 || t2.length === 0))
        return `Please select at least one option.
${styleText2(
          "reset",
          styleText2(
            "dim",
            `Press ${styleText2(["gray", "bgWhite", "inverse"], " space ")} to select, ${styleText2(
              "gray",
              styleText2("bgWhite", styleText2("inverse", " enter "))
            )} to submit`
          )
        )}`;
    },
    render() {
      const t2 = n3.withGuide ?? settings.withGuide, a2 = wrapTextWithPrefix(
        n3.output,
        n3.message,
        t2 ? `${symbolBar(this.state)}  ` : "",
        `${symbol(this.state)}  `
      ), r2 = `${t2 ? `${styleText2("gray", S_BAR)}
` : ""}${a2}
`, o = this.value ?? [], g = (i2, l) => {
        if (i2.disabled)
          return u3(i2, "disabled");
        const s = o.includes(i2.value);
        return l && s ? u3(i2, "active-selected") : s ? u3(i2, "selected") : u3(i2, l ? "active" : "inactive");
      };
      switch (this.state) {
        case "submit": {
          const i2 = this.options.filter(({ value: s }) => o.includes(s)).map((s) => u3(s, "submitted")).join(styleText2("dim", ", ")) || styleText2("dim", "none"), l = wrapTextWithPrefix(
            n3.output,
            i2,
            t2 ? `${styleText2("gray", S_BAR)}  ` : ""
          );
          return `${r2}${l}`;
        }
        case "cancel": {
          const i2 = this.options.filter(({ value: s }) => o.includes(s)).map((s) => u3(s, "cancelled")).join(styleText2("dim", ", "));
          if (i2.trim() === "")
            return `${r2}${styleText2("gray", S_BAR)}`;
          const l = wrapTextWithPrefix(
            n3.output,
            i2,
            t2 ? `${styleText2("gray", S_BAR)}  ` : ""
          );
          return `${r2}${l}${t2 ? `
${styleText2("gray", S_BAR)}` : ""}`;
        }
        case "error": {
          const i2 = t2 ? `${styleText2("yellow", S_BAR)}  ` : "", l = this.error.split(`
`).map(
            ($, v) => v === 0 ? `${t2 ? `${styleText2("yellow", S_BAR_END)}  ` : ""}${styleText2("yellow", $)}` : `   ${$}`
          ).join(`
`), s = r2.split(`
`).length, h2 = l.split(`
`).length + 1;
          return `${r2}${i2}${limitOptions({
            output: n3.output,
            options: this.options,
            cursor: this.cursor,
            maxItems: n3.maxItems,
            columnPadding: i2.length,
            rowPadding: s + h2,
            style: g
          }).join(`
${i2}`)}
${l}
`;
        }
        default: {
          const i2 = t2 ? `${styleText2("cyan", S_BAR)}  ` : "", l = r2.split(`
`).length, s = x ? formatInstructionFooter(n3.output, MULTISELECT_INSTRUCTIONS, t2) : t2 ? [styleText2("cyan", S_BAR_END)] : [], h2 = s.join(`
`), $ = s.length + 1;
          return `${r2}${i2}${limitOptions({
            output: n3.output,
            options: this.options,
            cursor: this.cursor,
            maxItems: n3.maxItems,
            columnPadding: i2.length,
            rowPadding: l + $,
            style: g
          }).join(`
${i2}`)}
${h2}
`;
        }
      }
    }
  }).prompt();
};
var u2 = {
  light: unicodeOr("\u2500", "-"),
  heavy: unicodeOr("\u2501", "="),
  block: unicodeOr("\u2588", "#")
};
var SELECT_INSTRUCTIONS = [
  `${styleText2("dim", "\u2191/\u2193")} to navigate`,
  `${styleText2("dim", "Enter:")} confirm`
];
var c2 = (t2, o) => t2.includes(`
`) ? t2.split(`
`).map((d) => o(d)).join(`
`) : o(t2);
var select = (t2) => {
  const o = (n3, m2) => {
    if (n3 === void 0)
      return "";
    const s = n3.label ?? String(n3.value);
    switch (m2) {
      case "disabled":
        return `${styleText2("gray", S_RADIO_INACTIVE)} ${c2(s, (i2) => styleText2("gray", i2))}${n3.hint ? ` ${styleText2("dim", `(${n3.hint ?? "disabled"})`)}` : ""}`;
      case "selected":
        return `${c2(s, (i2) => styleText2("dim", i2))}`;
      case "active":
        return `${styleText2("green", S_RADIO_ACTIVE)} ${s}${n3.hint ? ` ${styleText2("dim", `(${n3.hint})`)}` : ""}`;
      case "cancelled":
        return `${c2(s, (i2) => styleText2(["strikethrough", "dim"], i2))}`;
      default:
        return `${styleText2("dim", S_RADIO_INACTIVE)} ${c2(s, (i2) => styleText2("dim", i2))}`;
    }
  }, d = t2.showInstructions ?? true;
  return new n$1({
    options: t2.options,
    signal: t2.signal,
    input: t2.input,
    output: t2.output,
    initialValue: t2.initialValue,
    render() {
      const n3 = t2.withGuide ?? settings.withGuide, m2 = `${symbol(this.state)}  `, s = `${symbolBar(this.state)}  `, i2 = wrapTextWithPrefix(
        t2.output,
        t2.message,
        s,
        m2
      ), u3 = `${n3 ? `${styleText2("gray", S_BAR)}
` : ""}${i2}
`;
      switch (this.state) {
        case "submit": {
          const r2 = n3 ? `${styleText2("gray", S_BAR)}  ` : "", a2 = wrapTextWithPrefix(
            t2.output,
            o(this.options[this.cursor], "selected"),
            r2
          );
          return `${u3}${a2}`;
        }
        case "cancel": {
          const r2 = n3 ? `${styleText2("gray", S_BAR)}  ` : "", a2 = wrapTextWithPrefix(
            t2.output,
            o(this.options[this.cursor], "cancelled"),
            r2
          );
          return `${u3}${a2}${n3 ? `
${styleText2("gray", S_BAR)}` : ""}`;
        }
        default: {
          const r2 = n3 ? `${styleText2("cyan", S_BAR)}  ` : "", a2 = u3.split(`
`).length, p = d ? formatInstructionFooter(t2.output, SELECT_INSTRUCTIONS, n3) : n3 ? [styleText2("cyan", S_BAR_END)] : [], f = p.join(`
`), b = p.length + 1;
          return `${u3}${r2}${limitOptions({
            output: t2.output,
            cursor: this.cursor,
            options: this.options,
            maxItems: t2.maxItems,
            columnPadding: r2.length,
            rowPadding: a2 + b,
            style: (g, x) => o(g, g.disabled ? "disabled" : x ? "active" : "inactive")
          }).join(`
${r2}`)}
${f}
`;
        }
      }
    }
  }).prompt();
};
var i = `${styleText2("gray", S_BAR)}  `;
var text = (t2) => new n2({
  validate: t2.validate,
  placeholder: t2.placeholder,
  defaultValue: t2.defaultValue,
  initialValue: t2.initialValue,
  output: t2.output,
  signal: t2.signal,
  input: t2.input,
  render() {
    const r2 = t2?.withGuide ?? settings.withGuide, l = `${`${r2 ? `${styleText2("gray", S_BAR)}
` : ""}${symbol(this.state)}  `}${t2.message}
`, d = t2.placeholder && t2.placeholder.length > 0 ? (
      // biome-ignore lint/style/noNonNullAssertion: guarded by placeholder.length > 0
      styleText2("inverse", t2.placeholder[0]) + styleText2("dim", t2.placeholder.slice(1))
    ) : styleText2(["inverse", "hidden"], "_"), o = this.userInput ? this.userInputWithCursor : d, s = this.value ?? "";
    switch (this.state) {
      case "validating": {
        const n3 = r2 ? `${styleText2("cyan", S_BAR)}  ` : "", i2 = r2 ? styleText2("cyan", S_BAR_END) : "", c3 = styleText2("dim", o), $ = styleText2("dim", "Validating...");
        return `${l}${n3}${c3}
${i2}  ${$}
`;
      }
      case "error": {
        const n3 = this.error ? `  ${styleText2("yellow", this.error)}` : "", i2 = r2 ? `${styleText2("yellow", S_BAR)}  ` : "", c3 = r2 ? styleText2("yellow", S_BAR_END) : "";
        return `${l.trim()}
${i2}${o}
${c3}${n3}
`;
      }
      case "submit": {
        const n3 = s ? `${r2 ? "  " : ""}${styleText2("dim", s)}` : "", i2 = r2 ? styleText2("gray", S_BAR) : "";
        return `${l}${i2}${n3}`;
      }
      case "cancel": {
        const n3 = s ? `  ${styleText2(["strikethrough", "dim"], s)}` : "", i2 = r2 ? styleText2("gray", S_BAR) : "";
        return `${l}${i2}${n3}${s.trim() ? `
${i2}` : ""}`;
      }
      default: {
        const n3 = r2 ? `${styleText2("cyan", S_BAR)}  ` : "", i2 = r2 ? styleText2("cyan", S_BAR_END) : "";
        return `${l}${n3}${o}
${i2}
`;
      }
    }
  }
}).prompt();

// packages/cli/src/prompts.ts
var PromptCanceled = class extends Error {
  constructor() {
    super("canceled");
    this.name = "PromptCanceled";
  }
};
function interactiveTty(deps) {
  if (deps.isTty !== void 0) return deps.isTty;
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}
async function promptText(options) {
  const { validate, ...rest } = options;
  const value = await text({
    ...rest,
    ...validate !== void 0 ? { validate: (input) => validate(input ?? "") } : {}
  });
  if (isCancel(value)) throw new PromptCanceled();
  return value;
}
async function promptConfirm(message, initialValue = false) {
  const value = await confirm({ message, initialValue });
  if (isCancel(value)) throw new PromptCanceled();
  return value;
}
async function promptSelect(message, options, initialValue) {
  const value = await select({
    message,
    options: [...options],
    ...initialValue !== void 0 ? { initialValue } : {}
  });
  if (isCancel(value)) throw new PromptCanceled();
  return value;
}
async function promptMultiselect(message, options, initialValues = [], settings2 = {}) {
  const value = await multiselect({
    message,
    options: [...options],
    initialValues: [...initialValues],
    required: false,
    ...settings2.maxItems !== void 0 ? { maxItems: settings2.maxItems } : {}
  });
  if (isCancel(value)) throw new PromptCanceled();
  return value;
}
function promptAsk(question, fallback) {
  return promptText({ message: question, defaultValue: fallback });
}
var defaultPromptPort = {
  text: promptText,
  confirm: promptConfirm,
  select: promptSelect,
  multiselect: promptMultiselect
};
var SELECT_ALL = "*";
var SKILL_LIST_MAX_ITEMS = 12;
function skillChoiceOptions(options, context) {
  const installed = new Set(context.installed);
  return [
    {
      value: SELECT_ALL,
      label: `(all ${options.length} skills)`,
      hint: 'same as -s "*"; space to deselect single ones'
    },
    ...options.map((option) => {
      const hint = [installed.has(option.name) ? "installed" : null, option.description].filter((part) => part !== null && part !== void 0 && part.length > 0).join(" \xB7 ");
      return hint.length > 0 ? { value: option.name, label: option.name, hint } : { value: option.name, label: option.name };
    })
  ];
}
function promptSkillSelection(options, context) {
  return promptMultiselect(
    `Select skills to install into role "${context.role}" (space: toggle, a: all, i: invert)`,
    skillChoiceOptions(options, context),
    [],
    { maxItems: SKILL_LIST_MAX_ITEMS }
  );
}

// packages/core/src/version.ts
var NEO_VERSION = "0.2.8";

// packages/core/src/error.ts
var NeoError = class extends Error {
  kind;
  constructor(kind, message) {
    super(message);
    this.name = "NeoError";
    this.kind = kind;
  }
};

// packages/core/src/names.ts
var ROLE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
var SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
var AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
var WINDOWS_RESERVED = /* @__PURE__ */ new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i2) => `com${i2 + 1}`),
  ...Array.from({ length: 9 }, (_, i2) => `lpt${i2 + 1}`)
]);
function isSafeSkillName(name) {
  if (!SKILL_NAME_PATTERN.test(name) || name === "." || name === "..") return false;
  if (WINDOWS_RESERVED.has(name.toLowerCase())) return false;
  if (/[.\s]$/.test(name)) return false;
  return true;
}
function validateSkillName(name) {
  if (!isSafeSkillName(name)) {
    throw new NeoError(
      "usage",
      `invalid skill name ${JSON.stringify(name)}: must match ${SKILL_NAME_PATTERN.source} (no trailing dot/space, no Windows reserved names)`
    );
  }
}
function validateDomainName(name) {
  if (!ROLE_NAME_PATTERN.test(name)) {
    throw new NeoError(
      "usage",
      `invalid domain name ${JSON.stringify(name)}: must match ${ROLE_NAME_PATTERN.source}`
    );
  }
  if (name === "default") {
    throw new NeoError("usage", 'domain name "default" is reserved (the default layer is the base role, not a domain)');
  }
}
function validateRoleName(name) {
  if (!ROLE_NAME_PATTERN.test(name)) {
    throw new NeoError(
      "usage",
      `invalid role name ${JSON.stringify(name)}: must match ${ROLE_NAME_PATTERN.source}`
    );
  }
}
function safeBackupAgentName(agent) {
  return agent.replace(/[^A-Za-z0-9._-]/g, "_");
}

// packages/core/src/fs-util.ts
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
async function pathExists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    const code = error.code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
}
async function existsDir(target) {
  try {
    const stat = await fs.stat(target);
    return stat.isDirectory();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function writeFileAtomic(file, content, opts = {}) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  let mode = opts.defaultMode ?? 384;
  try {
    mode = (await fs.stat(file)).mode & 511;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const tmp = path.join(dir, `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(tmp, content, { encoding: "utf8", mode });
    if (process.platform !== "win32") await fs.chmod(tmp, mode);
    await fs.rename(tmp, file);
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => void 0);
  }
}

// packages/core/src/home-lock.ts
import fs2 from "node:fs/promises";
import path2 from "node:path";
var LOCK_NAME = ".neo.lock";
var DEFAULT_WAIT_TIMEOUT_MS = 3e4;
var DEFAULT_RETRY_MS = 100;
var DEFAULT_STALE_MS = 10 * 6e4;
async function acquireLockFile(lockPath, pid) {
  try {
    const handle = await fs2.open(lockPath, "wx");
    try {
      await handle.writeFile(`${pid}
`, "utf8");
    } finally {
      await handle.close();
    }
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
}
function pidAlive(raw) {
  const pid = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
async function withHomeLock(home, fn) {
  const lockPath = path2.join(home, LOCK_NAME);
  await fs2.mkdir(home, { recursive: true });
  const started = Date.now();
  let acquired = false;
  while (!acquired) {
    acquired = await acquireLockFile(lockPath, process.pid);
    if (acquired) break;
    if (Date.now() - started > DEFAULT_WAIT_TIMEOUT_MS) {
      throw new NeoError(
        "state",
        `another neo process holds ${lockPath}; close it or remove the stale lock file and retry`
      );
    }
    const content = await fs2.readFile(lockPath, "utf8").catch(() => null);
    const info = await fs2.stat(lockPath).catch(() => null);
    const staleByAge = info !== null && Date.now() - info.mtimeMs > DEFAULT_STALE_MS;
    const staleByPid = content !== null && !pidAlive(content);
    if (info !== null && (staleByAge || staleByPid)) {
      await fs2.rm(lockPath, { force: true }).catch(() => void 0);
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, DEFAULT_RETRY_MS));
  }
  try {
    return await fn();
  } finally {
    const content = await fs2.readFile(lockPath, "utf8").catch(() => null);
    if (content !== null && content.trim() === String(process.pid)) {
      await fs2.rm(lockPath, { force: true }).catch(() => void 0);
    }
  }
}

// packages/core/src/record.ts
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

// packages/core/src/paths.ts
import path3 from "node:path";
function resolveNeoHome({ env, homedir }) {
  const raw = env?.NEO_HOME?.trim();
  const value = raw ? expandTilde(raw, homedir) : path3.join(homedir, ".neo");
  if (!path3.isAbsolute(value)) {
    throw new NeoError(
      "state",
      `NEO_HOME must resolve to an absolute path, got: ${JSON.stringify(raw ?? value)}`
    );
  }
  return value;
}
function expandTilde(value, homedir) {
  if (value === "~") return homedir;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path3.join(homedir, value.slice(2));
  }
  return value;
}
var configPath = (home) => path3.join(home, "config.yaml");
var agentsYamlPath = (home) => path3.join(home, "agents.yaml");
var rolesDir = (home) => path3.join(home, "roles");
var roleDir = (home, role) => path3.join(rolesDir(home), role);
var roleSkillsDir = (home, role) => path3.join(roleDir(home, role), "skills");
var roleAgentsMd = (home, role) => path3.join(roleDir(home, role), "AGENTS.md");
var stateDir = (home) => path3.join(home, "state");
var mountsJsonPath = (home) => path3.join(stateDir(home), "mounts.json");
var locksDir = (home) => path3.join(stateDir(home), "locks");
var roleMcpPath = (home, role) => path3.join(roleDir(home, role), "mcp.yaml");
var roleYamlPath = (home, role) => path3.join(roleDir(home, role), "role.yaml");
var libraryDir = (home) => path3.join(home, "library");
var domainDir = (home, domain) => path3.join(libraryDir(home), domain);
var roleModelsPath = (home, role) => path3.join(roleDir(home, role), "models.yaml");
var rootsDir = (home) => path3.join(home, "roots");
var rootDir = (home, role, agent) => path3.join(rootsDir(home), role, agent);
var roleLockPath = (home, role) => path3.join(locksDir(home), `${role}.yaml`);

// packages/core/src/config.ts
var import_yaml2 = __toESM(require_dist(), 1);
import fs4 from "node:fs/promises";

// packages/core/src/models.ts
var import_yaml = __toESM(require_dist(), 1);
import fs3 from "node:fs/promises";

// packages/core/src/secrets.ts
var SENSITIVE_HEADER_NAMES = /* @__PURE__ */ new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "x-auth-token",
  "x-access-token",
  "cookie"
]);
function isSensitiveHeader(name) {
  return SENSITIVE_HEADER_NAMES.has(name.trim().toLowerCase());
}

// packages/core/src/models.ts
var THINKING_LEVELS = [
  "off",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra"
];
var MODEL_INPUTS = ["text", "image"];
var DEFAULT_CONTEXT_WINDOW = 1e6;
var DEFAULT_MODEL_INPUT = ["text", "image"];
var DEFAULT_THINKING_LEVELS = ["low", "high", "max"];
var TOKEN_SUFFIX = { k: 1e3, m: 1e6 };
var TOKEN_PATTERN = /^([0-9]+)([kKmM])?$/;
var ENV_REF = /^env:([A-Za-z_][A-Za-z0-9_]*)$/;
function invalid(context, message) {
  return new NeoError("state", `${context}: ${message}`);
}
function roleContext(role) {
  return `role "${role}" models.yaml`;
}
function parseTokenCount(value, where) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw invalid(where, `must be a positive integer (got ${String(value)})`);
    }
    return value;
  }
  if (typeof value === "string") {
    const match = TOKEN_PATTERN.exec(value.trim());
    if (match !== null) {
      const base = match[1];
      const suffix = match[2];
      const amount = Number(base) * (suffix === void 0 ? 1 : TOKEN_SUFFIX[suffix.toLowerCase()]);
      if (Number.isSafeInteger(amount) && amount > 0) return amount;
    }
  }
  throw invalid(
    where,
    `must be an integer such as 128000 or a suffixed value such as 512K/1M (got ${JSON.stringify(value)})`
  );
}
function parseModelEntry(context, providerId, index, raw) {
  const where = `providers.${providerId}.models[${index}]`;
  if (!isRecord(raw)) throw invalid(context, `${where} must be a mapping`);
  if (typeof raw.id !== "string" || raw.id.length === 0) {
    throw invalid(context, `${where}.id is required (non-empty string)`);
  }
  const out = { ...raw, id: raw.id };
  if (raw.name !== void 0 && typeof raw.name !== "string") {
    throw invalid(context, `${where}.name must be a string`);
  }
  if (raw.contextWindow !== void 0) {
    out.contextWindow = parseTokenCount(raw.contextWindow, `${context}: ${where}.contextWindow`);
  }
  if (raw.maxTokens !== void 0) {
    out.maxTokens = parseTokenCount(raw.maxTokens, `${context}: ${where}.maxTokens`);
  }
  if (raw.input !== void 0) {
    if (!Array.isArray(raw.input) || raw.input.length === 0) {
      throw invalid(context, `${where}.input must be a non-empty list`);
    }
    for (const item of raw.input) {
      if (typeof item !== "string" || !MODEL_INPUTS.includes(item)) {
        throw invalid(context, `${where}.input entries must be "text" or "image"`);
      }
    }
    out.input = [...raw.input];
  }
  if (raw.reasoning !== void 0 && typeof raw.reasoning !== "boolean") {
    throw invalid(context, `${where}.reasoning must be a boolean`);
  }
  if (raw.thinkingLevels !== void 0) {
    if (!Array.isArray(raw.thinkingLevels)) throw invalid(context, `${where}.thinkingLevels must be a list`);
    for (const level of raw.thinkingLevels) {
      if (typeof level !== "string" || !THINKING_LEVELS.includes(level)) {
        throw invalid(
          context,
          `${where}.thinkingLevels entries must be one of: ${THINKING_LEVELS.join("|")} (got ${JSON.stringify(level)})`
        );
      }
    }
    const levels = raw.thinkingLevels;
    if (levels.includes("off") && levels.includes("none")) {
      throw invalid(context, `${where}.thinkingLevels cannot contain both "off" and "none" (mutually exclusive)`);
    }
    out.thinkingLevels = [...levels];
  }
  if (raw.thinkingLevel !== void 0) {
    if (typeof raw.thinkingLevel !== "string" || !THINKING_LEVELS.includes(raw.thinkingLevel)) {
      throw invalid(context, `${where}.thinkingLevel must be one of: ${THINKING_LEVELS.join("|")}`);
    }
    out.thinkingLevel = raw.thinkingLevel;
    if (out.thinkingLevels !== void 0 && !out.thinkingLevels.includes(out.thinkingLevel)) {
      throw invalid(context, `${where}.thinkingLevel must be included in thinkingLevels`);
    }
  }
  return out;
}
function withModelDefaults(entry) {
  const out = { ...entry };
  if (out.contextWindow === void 0) out.contextWindow = DEFAULT_CONTEXT_WINDOW;
  if (out.input === void 0) out.input = [...DEFAULT_MODEL_INPUT];
  if (out.reasoning === void 0) out.reasoning = true;
  if (out.thinkingLevels === void 0) out.thinkingLevels = [...DEFAULT_THINKING_LEVELS];
  return out;
}
function providerModels(provider) {
  if (provider === void 0 || !Array.isArray(provider.models)) return [];
  return provider.models;
}
function findProviderModel(providers, providerId, modelId) {
  const provider = providers[providerId];
  if (provider === void 0) return void 0;
  const model = providerModels(provider).find((entry) => entry.id === modelId);
  return model === void 0 ? void 0 : { provider, model };
}
function parseModelDefault(context, raw) {
  if (raw === void 0) return void 0;
  if (typeof raw === "string") {
    const slash = raw.indexOf("/");
    if (slash <= 0 || slash === raw.length - 1) {
      throw invalid(context, 'default must be "provider/model" or a {provider, model} mapping');
    }
    return { provider: raw.slice(0, slash), model: raw.slice(slash + 1) };
  }
  if (!isRecord(raw)) throw invalid(context, 'default must be "provider/model" or a {provider, model} mapping');
  if (typeof raw.provider !== "string" || raw.provider.length === 0) {
    throw invalid(context, "default.provider is required");
  }
  if (typeof raw.model !== "string" || raw.model.length === 0) {
    throw invalid(context, "default.model is required");
  }
  return { provider: raw.provider, model: raw.model };
}
function parseProvider(context, id, raw) {
  if (!isRecord(raw)) throw invalid(context, `providers.${id} must be a mapping`);
  if (raw.baseUrl !== void 0 && typeof raw.baseUrl !== "string") {
    throw invalid(context, `providers.${id}.baseUrl must be a string`);
  }
  if (raw.api !== void 0 && typeof raw.api !== "string") {
    throw invalid(context, `providers.${id}.api must be a string`);
  }
  if (raw.apiKey !== void 0) {
    if (typeof raw.apiKey !== "string" || !ENV_REF.test(raw.apiKey)) {
      throw invalid(
        context,
        `providers.${id}.apiKey must be an env reference (env:VAR); literal keys are never stored`
      );
    }
  }
  if (raw.headers !== void 0) {
    if (!isRecord(raw.headers)) throw invalid(context, `providers.${id}.headers must be a mapping`);
    for (const [key, value] of Object.entries(raw.headers)) {
      if (typeof value !== "string") {
        throw invalid(context, `providers.${id}.headers.${key} must be a string`);
      }
      if (isSensitiveHeader(key) && !ENV_REF.test(value)) {
        throw invalid(
          context,
          `providers.${id}.headers.${key} must be an env reference (env:VAR) for sensitive headers`
        );
      }
    }
  }
  let models;
  if (raw.models !== void 0) {
    if (!Array.isArray(raw.models)) throw invalid(context, `providers.${id}.models must be a list`);
    models = raw.models.map((model, index) => parseModelEntry(context, id, index, model));
    const ids = /* @__PURE__ */ new Set();
    for (const model of models) {
      if (ids.has(model.id)) throw invalid(context, `providers.${id}.models has duplicate id "${model.id}"`);
      ids.add(model.id);
    }
  }
  return models === void 0 ? { ...raw } : { ...raw, models };
}
function parseProviderTable(context, raw) {
  if (raw === void 0) return {};
  if (!isRecord(raw)) throw invalid(context, '"providers" must be a mapping of id to provider');
  const providers = /* @__PURE__ */ Object.create(null);
  for (const [id, value] of Object.entries(raw)) {
    if (id === "__proto__" || id === "constructor" || id === "prototype") {
      throw invalid(context, `providers.${id}: reserved property name is not allowed`);
    }
    providers[id] = parseProvider(context, id, value);
  }
  return providers;
}
async function readRoleModels(home, role) {
  let text2;
  try {
    text2 = await fs3.readFile(roleModelsPath(home, role), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return { version: 1, providers: {} };
    }
    throw error;
  }
  let raw;
  try {
    raw = (0, import_yaml.parse)(text2);
  } catch (error) {
    throw invalid(roleContext(role), `not valid YAML (${error.message})`);
  }
  if (raw === null || raw === void 0) return { version: 1, providers: {} };
  if (!isRecord(raw)) throw invalid(roleContext(role), "expected a top-level mapping");
  const version = raw.version;
  if (version !== void 0 && version !== 1) {
    throw invalid(roleContext(role), `unsupported version ${String(version)} (supported: 1)`);
  }
  if (raw.providers !== void 0) {
    throw invalid(roleContext(role), '"providers" moved to config.yaml; remove provider definitions from this file');
  }
  const out = { version: 1, providers: {} };
  const parsedDefault = parseModelDefault(roleContext(role), raw.default);
  if (parsedDefault !== void 0) out.default = parsedDefault;
  return out;
}
var renderRef = (value) => {
  const match = ENV_REF.exec(value);
  return match === null ? value : `$${match[1]}`;
};
function resolveModelEnv(models, env, strict = true) {
  if (strict === false) return;
  for (const [id, provider] of Object.entries(models.providers)) {
    const check = (value, where) => {
      if (typeof value !== "string") return;
      const match = ENV_REF.exec(value);
      if (match === null) return;
      const name = match[1];
      const resolved = env[name];
      if (resolved === void 0 || resolved.length === 0) {
        throw new NeoError(
          "state",
          `models provider "${id}" ${where} references env:${name}, but ${name} is not set in the launch environment`
        );
      }
    };
    check(provider.apiKey, "apiKey");
    if (isRecord(provider.headers)) {
      for (const [key, value] of Object.entries(provider.headers)) check(value, `headers.${key}`);
    }
  }
}
var PI_THINKING_KEYS = ["minimal", "low", "medium", "high", "xhigh", "max"];
function renderPiThinkingLevelMap(levels) {
  const map = {};
  for (const level of PI_THINKING_KEYS) {
    map[level] = levels.includes(level) ? level : null;
  }
  if (levels.includes("none")) map.off = "none";
  return map;
}
function toPiModel(entry) {
  const model = withModelDefaults(entry);
  const out = { ...model };
  out.thinkingLevelMap = renderPiThinkingLevelMap(model.thinkingLevels ?? DEFAULT_THINKING_LEVELS);
  delete out.thinkingLevels;
  delete out.thinkingLevel;
  return out;
}
function renderPiModelsJson(models) {
  const providers = {};
  for (const [id, provider] of Object.entries(models.providers)) {
    const out = { ...provider };
    if (typeof out.apiKey === "string") out.apiKey = renderRef(out.apiKey);
    if (isRecord(out.headers)) {
      out.headers = Object.fromEntries(
        Object.entries(out.headers).map(([key, value]) => [
          key,
          typeof value === "string" ? renderRef(value) : value
        ])
      );
    }
    if (Array.isArray(out.models)) out.models = providerModels(provider).map(toPiModel);
    providers[id] = out;
  }
  return `${JSON.stringify({ providers }, null, 2)}
`;
}
function renderClaudeSettingsJson(existing, model) {
  let base = {};
  if (existing !== null) {
    try {
      const parsed = JSON.parse(existing);
      if (isRecord(parsed)) base = { ...parsed };
    } catch {
      base = {};
    }
  }
  if (model !== void 0) base.model = model;
  return `${JSON.stringify(base, null, 2)}
`;
}
function resolveClaudeLaunchEnv(provider, env) {
  const out = {};
  if (provider === void 0) return out;
  if (typeof provider.baseUrl === "string") {
    out.ANTHROPIC_BASE_URL = provider.baseUrl.replace(/\/v1\/?$/i, "").replace(/\/+$/, "");
  }
  if (typeof provider.apiKey === "string") {
    const match = ENV_REF.exec(provider.apiKey);
    if (match !== null) {
      const value = env[match[1]];
      if (value !== void 0 && value.length > 0) out.ANTHROPIC_AUTH_TOKEN = value;
    }
  }
  return out;
}
function renderPiSettingsJson(existing, fallback, override, thinkingLevelsByModel) {
  let base = {};
  if (existing !== null) {
    try {
      const parsed = JSON.parse(existing);
      if (isRecord(parsed)) base = { ...parsed };
    } catch {
      base = {};
    }
  }
  const chosen = override ?? fallback;
  if (chosen !== void 0) {
    base.defaultProvider = chosen.provider;
    base.defaultModel = chosen.model;
  }
  if (thinkingLevelsByModel !== void 0 && Object.keys(thinkingLevelsByModel).length > 0) {
    base.modelThinkingLevels = { ...thinkingLevelsByModel };
  }
  return `${JSON.stringify(base, null, 2)}
`;
}

// packages/core/src/config.ts
var SKILLS_REF_PATTERN = /^(latest|\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/;
function defaultConfig() {
  return { activeRole: null, targets: [], skillsRef: "latest", providers: {} };
}
function invalid2(message) {
  return new NeoError("state", `config.yaml: ${message}`);
}
async function readConfig(home) {
  const file = configPath(home);
  let text2;
  try {
    text2 = await fs4.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return { version: 1, config: defaultConfig(), raw: {} };
    }
    throw error;
  }
  let raw;
  try {
    raw = (0, import_yaml2.parse)(text2);
  } catch (error) {
    throw invalid2(`not valid YAML (${error.message})`);
  }
  if (raw === null || raw === void 0) {
    throw invalid2("file is empty; expected a mapping with version: 1");
  }
  if (!isRecord(raw)) {
    throw invalid2("expected a top-level mapping");
  }
  const version = raw.version;
  if (version === void 0) throw invalid2('missing required field "version"');
  if (version !== 1) {
    throw invalid2(
      `unsupported version ${String(version)} (supported major version: 1; refusing to read or write)`
    );
  }
  let activeRole = null;
  if (raw.activeRole !== void 0 && raw.activeRole !== null) {
    if (typeof raw.activeRole !== "string") throw invalid2('"activeRole" must be a string or null');
    if (!ROLE_NAME_PATTERN.test(raw.activeRole)) {
      throw invalid2(
        `"activeRole" is not a valid role name: ${JSON.stringify(raw.activeRole)} (must match ${ROLE_NAME_PATTERN.source})`
      );
    }
    activeRole = raw.activeRole;
  }
  const rawTargets = raw.targets ?? [];
  if (!Array.isArray(rawTargets)) throw invalid2('"targets" must be a list');
  const seen = /* @__PURE__ */ new Set();
  const targets = rawTargets.map((entry, index) => {
    if (!isRecord(entry)) throw invalid2(`targets[${index}] must be a mapping`);
    if (typeof entry.agent !== "string" || entry.agent.length === 0) {
      throw invalid2(`targets[${index}] is missing required string field "agent"`);
    }
    if (seen.has(entry.agent)) {
      throw invalid2(`duplicate target agent id "${entry.agent}"`);
    }
    seen.add(entry.agent);
    const target = { agent: entry.agent };
    if (entry.skillsDir !== void 0) {
      if (typeof entry.skillsDir !== "string" || entry.skillsDir.trim() === "") {
        throw invalid2(`targets[${index}].skillsDir must be a non-empty string`);
      }
      target.skillsDir = entry.skillsDir;
    }
    if (entry.agentsMd !== void 0) {
      if (typeof entry.agentsMd !== "boolean") {
        throw invalid2(`targets[${index}].agentsMd must be a boolean`);
      }
      target.agentsMd = entry.agentsMd;
    }
    return target;
  });
  let skillsRef = "latest";
  if (raw.install !== void 0) {
    if (!isRecord(raw.install)) throw invalid2('"install" must be a mapping');
    const ref = raw.install.skillsRef;
    if (ref !== void 0) {
      if (typeof ref !== "string" || ref.length === 0) {
        throw invalid2('"install.skillsRef" must be a non-empty string');
      }
      if (!SKILLS_REF_PATTERN.test(ref)) {
        throw invalid2(
          `"install.skillsRef" must be a version (e.g. 1.7.6) or "latest", got: ${JSON.stringify(ref)}`
        );
      }
      skillsRef = ref;
    }
  }
  const providers = parseProviderTable("config.yaml", raw.providers);
  const defaultModel = parseModelDefault("config.yaml", raw.defaultModel);
  return {
    version: 1,
    config: { activeRole, targets, skillsRef, providers, ...defaultModel !== void 0 ? { defaultModel } : {} },
    raw
  };
}
async function writeConfig(home, loaded) {
  const { config } = loaded;
  const rawTargets = Array.isArray(loaded.raw.targets) ? loaded.raw.targets : [];
  const rawInstall = isRecord(loaded.raw.install) ? loaded.raw.install : {};
  const out = { ...loaded.raw, version: 1, activeRole: config.activeRole };
  out.targets = config.targets.map((target) => {
    const prev = rawTargets.find(
      (entry2) => isRecord(entry2) && entry2.agent === target.agent
    );
    const entry = { ...prev ?? {}, agent: target.agent };
    if (target.skillsDir === void 0) delete entry.skillsDir;
    else entry.skillsDir = target.skillsDir;
    if (target.agentsMd === void 0) delete entry.agentsMd;
    else entry.agentsMd = target.agentsMd;
    return entry;
  });
  out.install = { ...rawInstall, skillsRef: config.skillsRef };
  if (config.defaultModel !== void 0) {
    out.defaultModel = `${config.defaultModel.provider}/${config.defaultModel.model}`;
  } else {
    delete out.defaultModel;
  }
  if (Object.keys(config.providers).length > 0) {
    out.providers = { ...config.providers };
  } else {
    delete out.providers;
  }
  const file = configPath(home);
  await writeFileAtomic(file, (0, import_yaml2.stringify)(out), { defaultMode: 420 });
}
async function setActiveRole(home, role) {
  const loaded = await readConfig(home);
  loaded.config.activeRole = role;
  await writeConfig(home, loaded);
}
async function ensureConfigSkeleton(home) {
  try {
    await fs4.stat(configPath(home));
    return false;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeConfig(home, { version: 1, config: defaultConfig(), raw: {} });
  return true;
}

// packages/core/src/agents.ts
var import_yaml3 = __toESM(require_dist(), 1);
import fs5 from "node:fs/promises";
function launchableAgentIds(registry) {
  return registry.filter((entry) => entry.isolate?.supports.includes("launch")).map((entry) => entry.id).sort();
}
function launchBlockReason(entry) {
  return entry.isolate === void 0 ? "no config-root redirect lever; its skill root is hardcoded" : "its isolation does not declare launch support";
}
var BUILTIN_AGENTS = [
  {
    id: "codex",
    skillsDir: "~/.agents/skills",
    skillsDirProject: ".agents/skills",
    agentsMd: "~/.codex/AGENTS.md",
    detect: { binary: "codex", dir: "~/.codex" },
    fallback: true,
    isolate: {
      homeEnv: "CODEX_HOME",
      homeDir: "~/.codex",
      skillsDir: "skills",
      instructionFile: "AGENTS.md",
      authFiles: ["auth.json"],
      shareDirs: ["plugins"],
      sharedSkillsDir: "~/.agents/skills",
      mcp: { format: "codex-toml", file: "config.toml" },
      models: { format: "codex-toml", file: "config.toml" },
      supports: ["launch", "global", "project"],
      supportLevel: "partial"
    }
  },
  {
    id: "claude-code",
    skillsDir: "~/.claude/skills",
    skillsDirProject: ".claude/skills",
    agentsMd: "~/.claude/CLAUDE.md",
    detect: { binary: "claude", dir: "~/.claude" },
    fallback: false,
    isolate: {
      homeEnv: "CLAUDE_CONFIG_DIR",
      homeDir: "~/.claude",
      skillsDir: "skills",
      instructionFile: "CLAUDE.md",
      authFiles: [".credentials.json"],
      shareDirs: ["plugins", "commands", "agents"],
      mcp: { format: "claude-json", file: ".claude.json" },
      models: { format: "claude-settings-json", file: "settings.json" },
      supports: ["launch", "global", "project"],
      supportLevel: "full"
    }
  },
  {
    // DSH:CLI 有完整重定向(DSH_HOME + DSH_AGENTS_HOME);GUI 单实例锁与 DSH_HOME 无关,不在启动面。
    id: "dsh",
    skillsDir: "~/.dsh/skills",
    skillsDirProject: ".dsh/skills",
    agentsMd: "~/.dsh/AGENTS.md",
    detect: { binary: "dsh", dir: "~/.dsh" },
    fallback: true,
    isolate: {
      homeEnv: "DSH_HOME",
      agentsEnv: "DSH_AGENTS_HOME",
      homeDir: "~/.dsh",
      skillsDir: "skills",
      instructionFile: "AGENTS.md",
      authFiles: [".credentials.yaml"],
      mcp: { format: "dsh-patch", file: "neo.patch.yml" },
      models: { format: "dsh-patch", file: "neo.patch.yml" },
      supports: ["launch", "global", "project"],
      supportLevel: "full"
    }
  },
  {
    // Pi:earendil-works/pi-coding-agent;PI_CODING_AGENT_DIR 重定向整套用户级配置。
    id: "pi",
    skillsDir: "~/.pi/agent/skills",
    skillsDirProject: ".pi/skills",
    agentsMd: "~/.pi/agent/AGENTS.md",
    detect: { binary: "pi", dir: "~/.pi/agent" },
    fallback: true,
    isolate: {
      homeEnv: "PI_CODING_AGENT_DIR",
      homeDir: "~/.pi/agent",
      skillsDir: "skills",
      instructionFile: "AGENTS.md",
      authFiles: ["auth.json", "mcp-auth.json"],
      shareDirs: [],
      sharedSkillsDir: "~/.agents/skills",
      mcp: { format: "pi-json", file: "mcp.json" },
      models: { format: "pi-models-json", file: "models.json", settingsFile: "settings.json" },
      isolatedFlags: ["--no-skills"],
      supports: ["launch", "global", "project"],
      supportLevel: "partial"
    }
  },
  {
    id: "zcode",
    skillsDir: "~/.zcode/skills",
    skillsDirProject: ".zcode/skills",
    agentsMd: "~/.zcode/AGENTS.md",
    detect: { dir: "~/.zcode" },
    fallback: true
  },
  {
    id: "cursor",
    skillsDir: "~/.cursor/skills",
    skillsDirProject: ".cursor/skills",
    detect: { dir: "~/.cursor" },
    fallback: true
  },
  {
    id: "opencode",
    skillsDir: "~/.config/opencode/skills",
    skillsDirProject: ".opencode/skills",
    agentsMd: "~/.config/opencode/AGENTS.md",
    detect: { binary: "opencode", dir: "~/.config/opencode" },
    fallback: true
  },
  {
    id: "gemini-cli",
    skillsDir: "~/.gemini/skills",
    skillsDirProject: ".gemini/skills",
    agentsMd: "~/.gemini/GEMINI.md",
    detect: { binary: "gemini", dir: "~/.gemini" },
    fallback: true
  },
  {
    id: "copilot",
    skillsDir: "~/.copilot/skills",
    skillsDirProject: ".github/skills",
    agentsMd: "~/.copilot/copilot-instructions.md",
    detect: { binary: "copilot", dir: "~/.copilot" },
    fallback: true
  },
  {
    // Windsurf 双路径并存:择主 stable channel(research 建议);~/.config/devin/skills 为新路径,未来复核。
    id: "windsurf",
    skillsDir: "~/.codeium/windsurf/skills",
    skillsDirProject: ".windsurf/skills",
    detect: { dir: "~/.codeium/windsurf" },
    fallback: true
  },
  {
    // 约定挂载目标,恒注册;AGENTS.md 规范不定义家目录位,故无 agentsMd。
    id: "universal",
    skillsDir: "~/.agents/skills",
    skillsDirProject: ".agents/skills",
    detect: { dir: "~/.agents/skills" },
    fallback: true
  }
];
function invalid3(message) {
  return new NeoError("state", `agents.yaml: ${message}`);
}
function validateModelsBlock(id, isolate) {
  const raw = isolate.models;
  if (!isRecord(raw)) throw invalid3(`agents.${id}.isolate.models must be a mapping`);
  const format = raw.format;
  if (format === "pi-models-json") {
    if (typeof raw.file !== "string" || raw.file.length === 0) {
      throw invalid3(`agents.${id}.isolate.models.file is required (non-empty string)`);
    }
    if (typeof raw.settingsFile !== "string" || raw.settingsFile.length === 0) {
      throw invalid3(`agents.${id}.isolate.models.settingsFile is required for pi-models-json`);
    }
    return;
  }
  if (format === "claude-settings-json") {
    if (typeof raw.file !== "string" || raw.file.length === 0) {
      throw invalid3(`agents.${id}.isolate.models.file is required (non-empty string)`);
    }
    return;
  }
  if (format === "dsh-patch" || format === "codex-toml") {
    if (typeof raw.file !== "string" || raw.file.length === 0) {
      throw invalid3(`agents.${id}.isolate.models.file is required (non-empty string)`);
    }
    const mcp = isolate.mcp;
    if (!isRecord(mcp) || mcp.format !== format || mcp.file !== raw.file) {
      throw invalid3(
        `agents.${id}.isolate.models with format ${format} must reuse isolate.mcp.file (same format)`
      );
    }
    return;
  }
  throw invalid3(`agents.${id}.isolate.models.format must be pi-models-json|dsh-patch|codex-toml|claude-settings-json`);
}
async function readAgentsExtension(home) {
  let text2;
  try {
    text2 = await fs5.readFile(agentsYamlPath(home), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  let raw;
  try {
    raw = (0, import_yaml3.parse)(text2);
  } catch (error) {
    throw invalid3(`not valid YAML (${error.message})`);
  }
  if (!isRecord(raw)) throw invalid3("expected a top-level mapping");
  const version = raw.version;
  if (version === void 0) throw invalid3('missing required field "version"');
  if (version !== 1) {
    throw invalid3(
      `unsupported version ${String(version)} (supported major version: 1; refusing to read or write)`
    );
  }
  if (raw.agents !== void 0 && !isRecord(raw.agents)) {
    throw invalid3('"agents" must be a mapping of agent id to entry');
  }
  const agents = /* @__PURE__ */ Object.create(null);
  for (const [id, value] of Object.entries(raw.agents ?? {})) {
    if (id === "__proto__" || id === "constructor" || id === "prototype") {
      throw invalid3(`agents.${id}: reserved property name is not allowed`);
    }
    if (!AGENT_ID_PATTERN.test(id)) {
      throw invalid3(`agents.${id}: invalid agent id (must match ${AGENT_ID_PATTERN.source})`);
    }
    if (!isRecord(value)) throw invalid3(`agents.${id} must be a mapping`);
    const skillsDir = value.skillsDir;
    if (typeof skillsDir !== "string" || skillsDir.length === 0) {
      throw invalid3(`agents.${id}.skillsDir is required (non-empty string)`);
    }
    const entry = { ...value, skillsDir };
    if (entry.skillsDirProject !== void 0 && typeof entry.skillsDirProject !== "string") {
      throw invalid3(`agents.${id}.skillsDirProject must be a string`);
    }
    if (entry.agentsMd !== void 0 && typeof entry.agentsMd !== "string") {
      throw invalid3(`agents.${id}.agentsMd must be a string`);
    }
    if (entry.detect !== void 0) {
      if (!isRecord(entry.detect)) throw invalid3(`agents.${id}.detect must be a mapping`);
      if (entry.detect.binary !== void 0 && typeof entry.detect.binary !== "string") {
        throw invalid3(`agents.${id}.detect.binary must be a string`);
      }
      if (entry.detect.dir !== void 0 && typeof entry.detect.dir !== "string") {
        throw invalid3(`agents.${id}.detect.dir must be a string`);
      }
    }
    if (entry.isolate !== void 0) {
      if (!isRecord(entry.isolate)) throw invalid3(`agents.${id}.isolate must be a mapping`);
      for (const field of ["homeEnv", "homeDir", "skillsDir", "instructionFile"]) {
        const value2 = entry.isolate[field];
        if (typeof value2 !== "string" || value2.length === 0) {
          throw invalid3(`agents.${id}.isolate.${field} is required (non-empty string)`);
        }
      }
      const supports = entry.isolate.supports;
      if (!Array.isArray(supports) || supports.some((item) => !["launch", "global", "project"].includes(item))) {
        throw invalid3(`agents.${id}.isolate.supports must be a list of launch|global|project`);
      }
      const level = entry.isolate.supportLevel;
      if (level !== "full" && level !== "partial" && level !== "none") {
        throw invalid3(`agents.${id}.isolate.supportLevel must be full|partial|none`);
      }
      if (entry.isolate.models !== void 0) {
        validateModelsBlock(id, entry.isolate);
      }
    }
    agents[id] = entry;
  }
  return { version: 1, agents };
}
function mergeRegistry(builtin, user) {
  const merged = /* @__PURE__ */ new Map();
  for (const entry of builtin) merged.set(entry.id, { ...entry });
  for (const [id, entry] of Object.entries(user)) merged.set(id, { ...entry, id });
  return [...merged.values()].sort((a2, b) => a2.id < b.id ? -1 : a2.id > b.id ? 1 : 0);
}

// packages/core/src/roles.ts
import fs6 from "node:fs/promises";
var RESERVED_ROLE_NAMES = ["default"];
function validateNewRoleName(name) {
  validateRoleName(name);
  if (RESERVED_ROLE_NAMES.includes(name)) {
    throw new NeoError(
      "usage",
      `role name ${JSON.stringify(name)} is reserved (default is the global base role)`
    );
  }
}
async function createRole(home, name) {
  validateNewRoleName(name);
  if (await existsDir(roleDir(home, name))) {
    throw new NeoError("state", `role "${name}" already exists`);
  }
  await fs6.mkdir(roleSkillsDir(home, name), { recursive: true });
  await fs6.writeFile(roleAgentsMd(home, name), roleAgentsMdStub(name), "utf8");
}
function roleAgentsMdStub(name) {
  return `<!-- neo: write the system prompt for role "${name}" here -->
`;
}
async function ensureRoleSkillsDir(home, role) {
  validateRoleName(role);
  await fs6.mkdir(roleSkillsDir(home, role), { recursive: true });
}
async function listRoles(home, activeRole) {
  const names = await roleNames(home);
  return Promise.all(
    names.map(async (name) => ({
      name,
      skills: (await skillNames(home, name)).length,
      active: name === activeRole
    }))
  );
}
async function listSkills(home, role) {
  if (role !== void 0) {
    validateRoleName(role);
    if (!await existsDir(roleDir(home, role))) {
      throw new NeoError("state", `role "${role}" not found`);
    }
    return [{ role, skills: await skillNames(home, role) }];
  }
  const names = await roleNames(home);
  return Promise.all(names.map(async (name) => ({ role: name, skills: await skillNames(home, name) })));
}
async function roleNames(home) {
  try {
    const entries = await fs6.readdir(rolesDir(home), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function skillNames(home, role) {
  try {
    const entries = await fs6.readdir(roleSkillsDir(home, role), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

// packages/core/src/locks.ts
var import_yaml4 = __toESM(require_dist(), 1);
import { randomUUID as randomUUID2 } from "node:crypto";
import fs7 from "node:fs/promises";
import path4 from "node:path";
function corrupt(role, message) {
  return new NeoError(
    "state",
    `lock for role "${role}" is corrupt (${message}); refusing to read or write \u2014 delete the lock and reinstall if intentional`
  );
}
async function readRoleLock(home, role) {
  const file = roleLockPath(home, role);
  let text2;
  try {
    text2 = await fs7.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  let raw;
  try {
    raw = (0, import_yaml4.parse)(text2);
  } catch (error) {
    throw corrupt(role, `not valid YAML: ${error.message}`);
  }
  if (raw === null || raw === void 0) throw corrupt(role, "file is empty");
  if (!isRecord(raw)) throw corrupt(role, "expected a top-level mapping");
  if (raw.version === void 0) throw corrupt(role, 'missing required field "version"');
  if (raw.version !== 1) {
    throw corrupt(
      role,
      `unsupported version ${String(raw.version)} (supported major version: 1)`
    );
  }
  if (raw.skills === void 0) throw corrupt(role, 'missing required field "skills"');
  if (!isRecord(raw.skills)) throw corrupt(role, '"skills" must be a mapping');
  const skills = {};
  for (const [name, value] of Object.entries(raw.skills)) {
    if (!isRecord(value)) throw corrupt(role, `skills.${name} must be a mapping`);
    if (typeof value.hash !== "string" || value.hash.length === 0) {
      throw corrupt(role, `skills.${name} is missing required string field "hash"`);
    }
    if (typeof value.sourceType !== "string") {
      throw corrupt(role, `skills.${name} is missing required string field "sourceType"`);
    }
    if (typeof value.installedAt !== "string") {
      throw corrupt(role, `skills.${name} is missing required string field "installedAt"`);
    }
    skills[name] = value;
  }
  return { ...raw, version: 1, skills };
}
async function listLockedRoles(home) {
  try {
    const entries = await fs7.readdir(locksDir(home));
    return entries.filter((name) => name.endsWith(".yaml")).map((name) => name.slice(0, -".yaml".length)).filter((role) => ROLE_NAME_PATTERN.test(role)).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
function isLockDirty(lock) {
  return lock !== null && lock.dirty === true;
}
async function clearLockDirty(home, role) {
  const lock = await readRoleLock(home, role);
  if (lock === null || !isLockDirty(lock)) return false;
  delete lock.dirty;
  await writeRoleLock(home, role, lock);
  return true;
}
async function markRoleLockDirty(home, role, preRead) {
  const lock = preRead === void 0 ? await readRoleLock(home, role) : preRead;
  if (lock !== null && isLockDirty(lock)) return;
  const merged = lock ?? { version: 1, skills: {} };
  merged.dirty = true;
  await writeRoleLock(home, role, merged);
}
async function writeRoleLock(home, role, lock) {
  const file = roleLockPath(home, role);
  await fs7.mkdir(locksDir(home), { recursive: true });
  const tmp = path4.join(locksDir(home), `.${path4.basename(file)}.${randomUUID2()}.tmp`);
  const skills = Object.fromEntries(
    Object.entries(lock.skills).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  );
  try {
    await fs7.writeFile(tmp, (0, import_yaml4.stringify)({ ...lock, skills }), "utf8");
    await fs7.rename(tmp, file);
  } finally {
    await fs7.rm(tmp, { recursive: true, force: true }).catch(() => void 0);
  }
}

// packages/core/src/library.ts
var import_yaml5 = __toESM(require_dist(), 1);
import fs8 from "node:fs/promises";
import path5 from "node:path";
function corrupt2(role, message) {
  return new NeoError(
    "state",
    `role "${role}" role.yaml is corrupt (${message}); refusing to read or write`
  );
}
function parseRoleYamlRecord(role, text2) {
  let raw;
  try {
    raw = (0, import_yaml5.parse)(text2);
  } catch (error) {
    throw corrupt2(role, `not valid YAML: ${error.message}`);
  }
  if (raw === null || raw === void 0) throw corrupt2(role, "file is empty");
  if (!isRecord(raw)) throw corrupt2(role, "expected a top-level mapping");
  if (raw.version === void 0) throw corrupt2(role, 'missing required field "version"');
  if (raw.version !== 1) {
    throw corrupt2(role, `unsupported version ${String(raw.version)} (supported major version: 1)`);
  }
  return raw;
}
async function readRoleDomains(home, role) {
  let text2;
  try {
    text2 = await fs8.readFile(roleYamlPath(home, role), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return readRoleDomainsFromText(role, text2);
}
function readRoleDomainsFromText(role, text2) {
  const raw = parseRoleYamlRecord(role, text2);
  if (raw.domains === void 0) return [];
  if (!Array.isArray(raw.domains)) throw corrupt2(role, '"domains" must be a list of strings');
  const seen = /* @__PURE__ */ new Set();
  const domains = [];
  for (const item of raw.domains) {
    if (typeof item !== "string" || !ROLE_NAME_PATTERN.test(item) || item === "default") {
      throw corrupt2(role, `domains entry ${JSON.stringify(item)} is not a valid domain name`);
    }
    if (seen.has(item)) continue;
    seen.add(item);
    domains.push(item);
  }
  return domains;
}
function renderRoleYaml(role, existingText, domains) {
  const raw = existingText === null ? {} : parseRoleYamlRecord(role, existingText);
  raw.version = 1;
  raw.domains = [...domains];
  return (0, import_yaml5.stringify)(raw);
}
function normalizeRoleYaml(role, text2) {
  const record = parseRoleYamlRecord(role, text2);
  const domains = Array.isArray(record.domains) ? record.domains.filter((item) => typeof item === "string") : [];
  return renderRoleYaml(role, text2, domains);
}
async function listDomains(home) {
  const out = [];
  let entries;
  try {
    entries = await fs8.readdir(libraryDir(home), { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a2, b) => a2.name < b.name ? -1 : 1)) {
    let skills = 0;
    try {
      const inner = await fs8.readdir(path5.join(libraryDir(home), entry.name), { withFileTypes: true });
      skills = inner.filter((item) => item.isDirectory()).length;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    out.push({ name: entry.name, skills });
  }
  return out;
}

// packages/core/src/assembly.ts
import fs9 from "node:fs/promises";
import path6 from "node:path";
function layerLabel(source) {
  return source.layer === "domain" ? `domain:${source.container}` : source.container;
}
async function layerSkillSources(home, layer, container) {
  const base = layer === "domain" ? domainDir(home, container) : roleSkillsDir(home, container);
  const out = /* @__PURE__ */ new Map();
  try {
    const entries = await fs9.readdir(base, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      out.set(entry.name, { layer, container, dir: path6.join(base, entry.name) });
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return out;
}
var LAYER_RANK = { default: 0, domain: 1, role: 2 };
async function resolveRoleAssembly(home, role) {
  const domains = await readRoleDomains(home, role);
  const stack = [
    { layer: "default", container: "default" },
    ...[...domains].sort().map((domain) => ({ layer: "domain", container: domain })),
    { layer: "role", container: role }
  ];
  const winners = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new Map();
  for (const frame of stack) {
    for (const [name, source] of await layerSkillSources(home, frame.layer, frame.container)) {
      const current = winners.get(name);
      if (current === void 0 || LAYER_RANK[frame.layer] > LAYER_RANK[current.layer]) {
        winners.set(name, source);
      }
      seen.set(name, [...seen.get(name) ?? [], source]);
    }
  }
  const resolutions = /* @__PURE__ */ new Map();
  for (const [name, winner] of winners) {
    const losers = (seen.get(name) ?? []).filter((source) => source.dir !== winner.dir).sort(
      (a2, b) => LAYER_RANK[b.layer] - LAYER_RANK[a2.layer] || (a2.container < b.container ? -1 : a2.container > b.container ? 1 : 0)
    );
    resolutions.set(name, { name, winner, losers });
  }
  return { role, domains, resolutions };
}

// packages/core/src/role-set.ts
import fs11 from "node:fs/promises";
import path7 from "node:path";

// packages/core/src/mcp.ts
var import_yaml6 = __toESM(require_dist(), 1);
import fs10 from "node:fs/promises";
var ENV_REF2 = /^env:([A-Za-z_][A-Za-z0-9_]*)$/;
function invalid4(role, message) {
  return new NeoError("state", `role "${role}" mcp.yaml: ${message}`);
}
function parseServer(role, name, raw) {
  if (!isRecord(raw)) throw invalid4(role, `servers.${name} must be a mapping`);
  const transport = raw.transport;
  if (transport !== "stdio" && transport !== "http") {
    throw invalid4(role, `servers.${name}.transport must be "stdio" or "http"`);
  }
  const stringMap = (value, field) => {
    if (value === void 0) return void 0;
    if (!isRecord(value)) throw invalid4(role, `servers.${name}.${field} must be a mapping`);
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (typeof item !== "string") {
        throw invalid4(role, `servers.${name}.${field}.${key} must be a string (use "env:VAR" for secrets)`);
      }
      out[key] = item;
    }
    return out;
  };
  if (transport === "stdio") {
    const command = raw.command;
    if (typeof command !== "string" || command.length === 0) {
      throw invalid4(role, `servers.${name}.command is required for stdio`);
    }
    const args = raw.args;
    if (args !== void 0) {
      if (!Array.isArray(args) || args.some((item) => typeof item !== "string")) {
        throw invalid4(role, `servers.${name}.args must be a list of strings`);
      }
    }
    const env = stringMap(raw.env, "env");
    return { transport, command, args: args ?? [], ...env !== void 0 ? { env } : {} };
  }
  const url = raw.url;
  if (typeof url !== "string" || url.length === 0) {
    throw invalid4(role, `servers.${name}.url is required for http`);
  }
  const headers = stringMap(raw.headers, "headers");
  if (headers !== void 0) {
    for (const [key, value] of Object.entries(headers)) {
      if (isSensitiveHeader(key) && !ENV_REF2.test(value)) {
        throw invalid4(role, `servers.${name}.headers.${key} must be an env reference (env:VAR)`);
      }
    }
  }
  return { transport, url, ...headers !== void 0 ? { headers } : {} };
}
async function readRoleMcp(home, role) {
  let text2;
  try {
    text2 = await fs10.readFile(roleMcpPath(home, role), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
  return parseRoleMcpText(role, text2);
}
function parseRoleMcpText(role, text2) {
  let raw;
  try {
    raw = (0, import_yaml6.parse)(text2);
  } catch (error) {
    throw invalid4(role, `not valid YAML (${error.message})`);
  }
  if (raw === null || raw === void 0) return {};
  if (!isRecord(raw)) throw invalid4(role, "expected a top-level mapping");
  const version = raw.version;
  if (version !== void 0 && version !== 1) {
    throw invalid4(role, `unsupported version ${String(version)} (supported: 1)`);
  }
  if (raw.servers === void 0) return {};
  if (!isRecord(raw.servers)) throw invalid4(role, '"servers" must be a mapping of name to server');
  const servers = {};
  for (const [name, value] of Object.entries(raw.servers)) {
    if (name === "__proto__" || name === "constructor" || name === "prototype") {
      throw invalid4(role, `servers.${name}: reserved property name is not allowed`);
    }
    servers[name] = parseServer(role, name, value);
  }
  return servers;
}
var SECRET_KEY_SUBSTRINGS = [
  "token",
  "secret",
  "password",
  "passwd",
  "credential",
  "authorization",
  "cookie"
];
function isSecretVarName(name) {
  const key = name.trim().toLowerCase();
  if (isSensitiveHeader(key)) return true;
  if (SECRET_KEY_SUBSTRINGS.some((part) => key.includes(part))) return true;
  if (/api[-_]?key/.test(key)) return true;
  if (/(^|[^a-z0-9])key([^a-z0-9]|$)/.test(key)) return true;
  if (/(^|[^a-z0-9])auth([^a-z0-9]|$)/.test(key)) return true;
  return false;
}
function validateMcpForWrite(role, text2) {
  const servers = parseRoleMcpText(role, text2);
  for (const [name, server] of Object.entries(servers)) {
    const check = (map, field) => {
      for (const [key, value] of Object.entries(map ?? {})) {
        if (isSecretVarName(key) && !ENV_REF2.test(value)) {
          throw invalid4(
            role,
            `servers.${name}.${field}.${key} looks like a credential but holds a literal value; reference it as env:VAR (e.g. env:${key.toUpperCase()})`
          );
        }
      }
    };
    if (server.transport === "stdio") check(server.env, "env");
    else check(server.headers, "headers");
  }
  return servers;
}
function mergeMcpServers(base, override) {
  return { ...base, ...override };
}
function collectMcpEnvRefs(servers) {
  const out = {};
  for (const [name, server] of Object.entries(servers)) {
    const refs = {};
    const collect = (map) => {
      for (const [key, value] of Object.entries(map ?? {})) {
        const match = ENV_REF2.exec(value);
        if (match !== null) refs[key] = match[1];
      }
    };
    if (server.transport === "stdio") collect(server.env);
    else collect(server.headers);
    if (Object.keys(refs).length > 0) out[name] = refs;
  }
  return out;
}
function resolveMcpEnv(servers, env, target, strict = true) {
  const extraEnv = {};
  const headerRefs = {};
  const resolve = (ref, where) => {
    const match = ENV_REF2.exec(ref);
    if (match === null) return ref;
    const name = match[1];
    const value = env[name];
    if (value === void 0 || value.length === 0) {
      if (strict === false) return void 0;
      throw new NeoError(
        "state",
        `mcp ${where} references env:${name}, but ${name} is not set in the launch environment`
      );
    }
    return value;
  };
  for (const [name, server] of Object.entries(servers)) {
    if (server.transport === "stdio") {
      for (const [key, value] of Object.entries(server.env ?? {})) {
        if (!ENV_REF2.test(value)) continue;
        const resolvedValue = resolve(value, `${name}.env.${key}`);
        if (resolvedValue !== void 0) extraEnv[key] = resolvedValue;
      }
      continue;
    }
    for (const [key, value] of Object.entries(server.headers ?? {})) {
      if (ENV_REF2.test(value)) {
        if (target !== "claude-code") {
          throw new NeoError(
            "state",
            `mcp ${name}.headers.${key} uses ${value}, but agent "${target}" cannot expand env refs in http headers; use a literal value or drop the ref`
          );
        }
        headerRefs[key] = value;
      }
    }
  }
  return { extraEnv, headerRefs };
}
var escapeToml = (value) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
var tomlValue = (value) => typeof value === "string" ? `"${escapeToml(value)}"` : `[${value.map((item) => `"${escapeToml(item)}"`).join(", ")}]`;
var renderTomlMap = (map) => `{ ${Object.entries(map).map(([key, value]) => `${key} = "${escapeToml(value)}"`).join(", ")} }`;
var CODEX_EFFORTS = /* @__PURE__ */ new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);
function codexModelLines(models) {
  const lines = [];
  if (models.default !== void 0) {
    const chosen = models.default;
    const entry = findProviderModel(models.providers, chosen.provider, chosen.model)?.model;
    const model = withModelDefaults(entry ?? { id: chosen.model });
    lines.push(`model = ${tomlValue(chosen.model)}`);
    lines.push(`model_provider = ${tomlValue(chosen.provider)}`);
    if (model.thinkingLevel !== void 0 && CODEX_EFFORTS.has(model.thinkingLevel)) {
      lines.push(`model_reasoning_effort = ${tomlValue(model.thinkingLevel)}`);
    }
    if (model.contextWindow !== void 0) {
      lines.push(`model_context_window = ${model.contextWindow}`);
      lines.push(`model_auto_compact_token_limit = ${Math.floor(model.contextWindow * 0.9)}`);
    }
    lines.push("");
  }
  for (const [id, provider] of Object.entries(models.providers)) {
    const baseUrl = typeof provider.baseUrl === "string" ? provider.baseUrl.replace(/\/+$/, "") : void 0;
    lines.push(`[model_providers."${escapeToml(id)}"]`);
    lines.push(`name = ${tomlValue(typeof provider.displayName === "string" ? provider.displayName : id)}`);
    if (baseUrl !== void 0) {
      lines.push(`base_url = ${tomlValue(stripV1Suffix(baseUrl))}`);
      lines.push(`model_catalog_url = ${tomlValue(`${baseUrl}/models`)}`);
    }
    if (typeof provider.apiKey === "string") {
      const ref = ENV_REF2.exec(provider.apiKey)?.[1];
      if (ref !== void 0) lines.push(`env_key = ${tomlValue(ref)}`);
    }
    lines.push('wire_api = "responses"');
    lines.push("");
  }
  return lines;
}
function renderCodexConfig(servers, opts = {}) {
  const lines = ["# Generated by neo \u2014 do not edit; run `neo run` to refresh.", ""];
  if (opts.models !== void 0) lines.push(...codexModelLines(opts.models));
  for (const skill of opts.skillDisables ?? []) {
    lines.push("[[skills.config]]", `path = "${escapeToml(skill)}"`, "enabled = false", "");
  }
  for (const [name, server] of Object.entries(servers)) {
    if (server.transport === "stdio") {
      lines.push(`[mcp_servers.${name}]`, `command = ${tomlValue(server.command)}`);
      if (server.args.length > 0) lines.push(`args = ${tomlValue(server.args)}`);
      const literalEnv = Object.fromEntries(
        Object.entries(server.env ?? {}).filter(([, value]) => !ENV_REF2.test(value))
      );
      if (Object.keys(literalEnv).length > 0) lines.push(`env = ${renderTomlMap(literalEnv)}`);
      lines.push("");
      continue;
    }
    lines.push(`[mcp_servers.${name}]`, `url = ${tomlValue(server.url)}`);
    const literalHeaders = Object.fromEntries(
      Object.entries(server.headers ?? {}).filter(([, value]) => !ENV_REF2.test(value))
    );
    if (Object.keys(literalHeaders).length > 0) {
      lines.push(`http_headers = ${renderTomlMap(literalHeaders)}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}
`;
}
var renderJsonServer = (server, headerRefs) => {
  if (server.transport === "stdio") {
    const literalEnv = Object.fromEntries(
      Object.entries(server.env ?? {}).filter(([, value]) => !ENV_REF2.test(value))
    );
    return {
      command: server.command,
      args: [...server.args],
      ...Object.keys(literalEnv).length > 0 ? { env: literalEnv } : {}
    };
  }
  const headers = Object.fromEntries(
    Object.entries(server.headers ?? {}).map(([key, value]) => {
      const ref = ENV_REF2.exec(value)?.[1];
      return [key, ref !== void 0 ? `\${${ref}}` : value];
    })
  );
  void headerRefs;
  return { type: "http", url: server.url, ...Object.keys(headers).length > 0 ? { headers } : {} };
};
function renderPiMcpJson(servers, headerRefs = {}) {
  const mcpServers = Object.fromEntries(
    Object.entries(servers).map(([name, server]) => [name, renderJsonServer(server, headerRefs)])
  );
  return `${JSON.stringify({ mcpServers }, null, 2)}
`;
}
function renderClaudeConfig(existing, servers, headerRefs = {}) {
  let base = {};
  if (existing !== null) {
    try {
      const parsed = JSON.parse(existing);
      if (isRecord(parsed)) base = { ...parsed };
    } catch {
      base = {};
    }
  }
  const mcpServers = Object.fromEntries(
    Object.entries(servers).map(([name, server]) => [name, renderJsonServer(server, headerRefs)])
  );
  return `${JSON.stringify({ ...base, mcpServers }, null, 2)}
`;
}
function stripV1Suffix(baseUrl) {
  return baseUrl.replace(/\/v1\/?$/i, "");
}
function dshModelEntry(entry) {
  const model = withModelDefaults(entry);
  const out = {
    id: model.id,
    contextWindow: model.contextWindow,
    input: model.input
  };
  if (model.name !== void 0) out.name = model.name;
  if (model.maxTokens !== void 0) out.maxTokens = model.maxTokens;
  const levels = model.thinkingLevels ?? [];
  if (levels.length > 0) {
    out.reasoningEfforts = Object.fromEntries(levels.map((level) => [level, level]));
  }
  return out;
}
function dshProviderEntry(provider) {
  const out = {};
  if (typeof provider.displayName === "string") out.displayName = provider.displayName;
  if (typeof provider.apiKey === "string") {
    const match = ENV_REF2.exec(provider.apiKey);
    if (match !== null) out.apiKeyEnv = match[1];
  }
  if (typeof provider.api === "string") out.api = provider.api;
  if (typeof provider.baseUrl === "string") out.baseURL = stripV1Suffix(provider.baseUrl);
  const models = providerModels(provider).map((entry) => dshModelEntry(entry));
  if (models.length > 0) out.models = models;
  return out;
}
function renderDshPatch(servers, models) {
  const entries = Object.entries(servers).map(([name, server]) => {
    const config = { serverName: name };
    if (server.transport === "stdio") {
      config.transport = "stdio";
      config.command = server.command;
      if (server.args.length > 0) config.args = [...server.args];
      const literalEnv = Object.fromEntries(
        Object.entries(server.env ?? {}).filter(([, value]) => !ENV_REF2.test(value))
      );
      if (Object.keys(literalEnv).length > 0) config.env = literalEnv;
    } else {
      config.transport = "streamable-http";
      config.url = server.url;
      const literalHeaders = Object.fromEntries(
        Object.entries(server.headers ?? {}).filter(([, value]) => !ENV_REF2.test(value))
      );
      if (Object.keys(literalHeaders).length > 0) config.headers = literalHeaders;
    }
    return {
      id: `neo-mcp-${name}`,
      name: "@deepseek-ai/dsh-mcp-client",
      config
    };
  });
  if (models !== void 0) {
    const providerEntries = Object.entries(models.providers);
    if (providerEntries.length > 0) {
      entries.push({
        id: "llm-pi-ai",
        name: "@deepseek-ai/dsh-llm-pi-ai",
        config: {
          providers: Object.fromEntries(
            providerEntries.map(([id, provider]) => [id, dshProviderEntry(provider)])
          )
        }
      });
    }
    if (models.default !== void 0) {
      const selected = findProviderModel(
        models.providers,
        models.default.provider,
        models.default.model
      )?.model;
      entries.push({
        id: "agent-default-model",
        name: "@deepseek-ai/dsh-agent-default-model",
        config: {
          provider: models.default.provider,
          model: models.default.model,
          ...selected?.thinkingLevel !== void 0 ? { reasoningEffort: selected.thinkingLevel } : {}
        }
      });
    }
  }
  return (0, import_yaml6.stringify)(entries);
}

// packages/core/src/role-set.ts
async function readTextOrNull(file) {
  try {
    return await fs11.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
var homeLabel = (home, file) => path7.relative(home, file).split(path7.sep).join("/");
async function setRoleAssembly(home, input) {
  const dryRun = input.dryRun === true;
  validateRoleName(input.role);
  if (input.role !== "default" && !await existsDir(roleDir(home, input.role))) {
    throw new NeoError(
      "state",
      `role "${input.role}" does not exist (create it first: neo create ${input.role})`
    );
  }
  if (input.domains !== void 0) {
    for (const domain of input.domains) validateDomainName(domain);
  }
  if (input.mcp !== void 0) validateMcpForWrite(input.role, input.mcp);
  const lock = await readRoleLock(home, input.role);
  const targets = [];
  if (input.agentsMd !== void 0) {
    targets.push({ key: "agentsMd", file: roleAgentsMd(home, input.role), newText: input.agentsMd, compareBase: null });
  }
  if (input.domains !== void 0) {
    const file = roleYamlPath(home, input.role);
    const existing = await readTextOrNull(file);
    targets.push({
      key: "domains",
      file,
      newText: renderRoleYaml(input.role, existing, input.domains),
      compareBase: existing === null ? null : normalizeRoleYaml(input.role, existing)
    });
  }
  if (input.mcp !== void 0) {
    targets.push({ key: "mcp", file: roleMcpPath(home, input.role), newText: input.mcp, compareBase: null });
  }
  const files = [];
  const changed = { agentsMd: false, domains: false, mcp: false };
  for (const target of targets) {
    const oldText = await readTextOrNull(target.file);
    const oldCmp = target.compareBase ?? oldText;
    const change = oldCmp === null ? "created" : oldCmp === target.newText ? "unchanged" : "updated";
    const diff = change === "unchanged" ? "" : unifiedDiff(homeLabel(home, target.file), oldText ?? "", target.newText);
    files.push({ file: homeLabel(home, target.file), change, diff });
    if (change !== "unchanged") {
      changed[target.key] = true;
      if (!dryRun) await writeFileAtomic(target.file, target.newText);
    }
  }
  const assemblyChanged = Object.values(changed).some(Boolean);
  const dirty = isLockDirty(lock) || assemblyChanged;
  if (!dryRun && assemblyChanged) await markRoleLockDirty(home, input.role, lock);
  return { role: input.role, dryRun, changed, files, dirty };
}
var DIFF_CONTEXT = 3;
function splitDiffLines(text2) {
  if (text2.length === 0) return [];
  const lines = text2.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
function unifiedDiff(label, oldText, newText) {
  if (oldText === newText) return "";
  const a2 = splitDiffLines(oldText);
  const b = splitDiffLines(newText);
  const n3 = a2.length;
  const m2 = b.length;
  const lcs = Array.from({ length: n3 + 1 }, () => new Array(m2 + 1).fill(0));
  for (let i2 = n3 - 1; i2 >= 0; i2--) {
    const row = lcs[i2];
    const next = lcs[i2 + 1];
    for (let j = m2 - 1; j >= 0; j--) {
      row[j] = a2[i2] === b[j] ? next[j + 1] + 1 : Math.max(next[j], row[j + 1]);
    }
  }
  const ops = [];
  for (let i2 = 0, j = 0; i2 < n3 || j < m2; ) {
    if (i2 < n3 && j < m2 && a2[i2] === b[j]) {
      ops.push({ kind: " ", line: a2[i2] });
      i2++;
      j++;
    } else if (j >= m2 || i2 < n3 && lcs[i2 + 1][j] >= lcs[i2][j + 1]) {
      ops.push({ kind: "-", line: a2[i2] });
      i2++;
    } else {
      ops.push({ kind: "+", line: b[j] });
      j++;
    }
  }
  const groups = [];
  for (let idx = 0; idx < ops.length; idx++) {
    if (ops[idx].kind === " ") continue;
    const start = Math.max(0, idx - DIFF_CONTEXT);
    const end = Math.min(ops.length, idx + DIFF_CONTEXT + 1);
    const prev = groups[groups.length - 1];
    if (prev !== void 0 && start <= prev.end) prev.end = Math.max(prev.end, end);
    else groups.push({ start, end });
  }
  const body = [];
  for (const group of groups) {
    let oldBefore = 0;
    let newBefore = 0;
    for (let k = 0; k < group.start; k++) {
      if (ops[k].kind !== "+") oldBefore++;
      if (ops[k].kind !== "-") newBefore++;
    }
    let oldCount = 0;
    let newCount = 0;
    for (let k = group.start; k < group.end; k++) {
      if (ops[k].kind !== "+") oldCount++;
      if (ops[k].kind !== "-") newCount++;
    }
    body.push(
      `@@ -${oldBefore + (oldCount > 0 ? 1 : 0)},${oldCount} +${newBefore + (newCount > 0 ? 1 : 0)},${newCount} @@`
    );
    for (let k = group.start; k < group.end; k++) {
      body.push(`${ops[k].kind}${ops[k].line}`);
    }
  }
  const header = [
    `--- ${oldText.length === 0 ? "/dev/null" : label}`,
    `+++ ${newText.length === 0 ? "/dev/null" : label}`
  ];
  return `${[...header, ...body].join("\n")}
`;
}

// packages/core/src/install.ts
import fs12 from "node:fs/promises";
import os from "node:os";
import path8 from "node:path";
function buildUpstreamAddArgs(opts) {
  const base = ["npx", "-y", `skills@${opts.skillsRef}`, "add", opts.source];
  if (opts.listOnly) return [...base, "-l"];
  const selection = opts.skills?.kind === "all" ? ["-s", "*"] : (opts.skills?.names ?? []).flatMap((name) => ["-s", name]);
  return [...base, "-a", "universal", "-y", "--copy", "--json", ...selection];
}
function parseSourceSkillList(output) {
  const clean = output.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r/g, "").replace(/│/g, "|");
  const lines = clean.split("\n");
  const parsed = [];
  let inList = false;
  let current;
  let group;
  for (const line of lines) {
    if (/Available Skills/i.test(line)) {
      inList = true;
      continue;
    }
    if (!inList) continue;
    if (/Use --skill|Installation failed|Found \d+ skills?/i.test(line)) break;
    const name = /^\|\s{4}([a-zA-Z0-9][a-zA-Z0-9._+-]*)\s*$/.exec(line)?.[1];
    if (name !== void 0) {
      if (!parsed.some((item) => item.name === name)) {
        current = { name, ...group !== void 0 ? { group } : {} };
        parsed.push(current);
      }
      continue;
    }
    const description = /^\|\s{6,}(\S.*)$/.exec(line)?.[1]?.trim();
    if (description !== void 0 && current !== void 0 && current.description === void 0) {
      current.description = description;
      continue;
    }
    const trimmed = line.trim();
    if (/^[A-Za-z][A-Za-z0-9 ()-]{0,39}$/.test(trimmed)) group = trimmed;
  }
  return parsed.map((item) => {
    const hint = [item.group, item.description].filter((part) => part !== void 0 && part.length > 0).join(" \xB7 ");
    return hint.length > 0 ? { name: item.name, description: hint } : { name: item.name };
  });
}
async function listSourceSkills(ports, opts) {
  const staging = await makeStaging(ports);
  try {
    return await ports.exec.run(
      buildUpstreamAddArgs({ skillsRef: opts.skillsRef, source: opts.source, listOnly: true }),
      { cwd: staging }
    );
  } finally {
    await fs12.rm(staging, { recursive: true, force: true }).catch(() => void 0);
  }
}
function backupName(name, at) {
  return `${name}.bak-${at.toISOString().replace(/[-:.]/g, "")}`;
}
async function addSource(ports, home, opts) {
  const now = ports.now ? ports.now() : /* @__PURE__ */ new Date();
  validateRoleName(opts.role);
  if (opts.skills.kind === "list") {
    for (const name of [...new Set(opts.skills.names)]) validateSkillName(name);
  }
  const existingLock = await readRoleLock(home, opts.role);
  const names = opts.skills.kind === "all" ? null : [...new Set(opts.skills.names)];
  const staging = await makeStaging(ports);
  try {
    const result = await ports.exec.run(
      buildUpstreamAddArgs({ skillsRef: opts.skillsRef, source: opts.source, skills: opts.skills }),
      { cwd: staging }
    );
    const report = {
      role: opts.role,
      source: opts.source,
      installed: [],
      failed: []
    };
    if (result.code !== 0) {
      report.upstreamError = summarizeUpstreamFailure(result);
      report.failed = (names ?? []).map((name) => ({ name, error: "upstream install failed" }));
      return report;
    }
    const stagedNames = await enumerateStagedSkills(staging);
    if (names) {
      const expected = [...names].sort();
      const actual = [...stagedNames].sort();
      if (expected.join("\n") !== actual.join("\n")) {
        report.upstreamError = `upstream enumeration mismatch: -s requested [${expected.join(", ")}] but staging contains [${actual.join(", ")}]`;
        report.failed = names.map((name) => ({ name, error: "enumeration mismatch" }));
        return report;
      }
    } else if (stagedNames.length === 0) {
      report.upstreamError = "no skills found in source (staging .agents/skills is empty)";
      return report;
    }
    const upstreamLock = await readUpstreamLock(staging);
    await ensureRoleSkillsDir(home, opts.role);
    const skills = { ...existingLock?.skills ?? {} };
    for (const name of stagedNames) {
      if (!isSafeSkillName(name)) {
        report.failed.push({ name, error: `unsafe staged skill name ${JSON.stringify(name)}` });
        continue;
      }
      const meta = upstreamLock?.skills?.[name];
      const hash = typeof meta?.computedHash === "string" ? meta.computedHash : "";
      if (!hash) {
        report.failed.push({
          name,
          error: "upstream lock has no computedHash for this skill (refusing to install untracked content)"
        });
        continue;
      }
      try {
        const replaced = await relocateSkill(path8.join(staging, ".agents", "skills", name), home, opts.role, name, now);
        skills[name] = buildLockEntry(opts.source, meta, hash, now);
        report.installed.push({ name, hash, replaced });
      } catch (error) {
        report.failed.push({ name, error: error.message });
      }
    }
    if (report.installed.length > 0) {
      const merged = { ...existingLock, version: 1, skills };
      await writeRoleLock(home, opts.role, merged);
    }
    return report;
  } finally {
    await fs12.rm(staging, { recursive: true, force: true }).catch(() => void 0);
  }
}
async function addSourceToDomain(ports, home, opts) {
  const now = ports.now ? ports.now() : /* @__PURE__ */ new Date();
  validateDomainName(opts.domain);
  if (opts.skills.kind === "list") {
    for (const name of [...new Set(opts.skills.names)]) validateSkillName(name);
  }
  const names = opts.skills.kind === "all" ? null : [...new Set(opts.skills.names)];
  const staging = await makeStaging(ports);
  try {
    const result = await ports.exec.run(
      buildUpstreamAddArgs({ skillsRef: opts.skillsRef, source: opts.source, skills: opts.skills }),
      { cwd: staging }
    );
    const report = {
      domain: opts.domain,
      source: opts.source,
      installed: [],
      failed: []
    };
    if (result.code !== 0) {
      report.upstreamError = summarizeUpstreamFailure(result);
      report.failed = (names ?? []).map((name) => ({ name, error: "upstream install failed" }));
      return report;
    }
    const stagedNames = await enumerateStagedSkills(staging);
    if (names) {
      const expected = [...names].sort();
      const actual = [...stagedNames].sort();
      if (expected.join("\n") !== actual.join("\n")) {
        report.upstreamError = `upstream enumeration mismatch: -s requested [${expected.join(", ")}] but staging contains [${actual.join(", ")}]`;
        report.failed = names.map((name) => ({ name, error: "enumeration mismatch" }));
        return report;
      }
    } else if (stagedNames.length === 0) {
      report.upstreamError = "no skills found in source (staging .agents/skills is empty)";
      return report;
    }
    const upstreamLock = await readUpstreamLock(staging);
    await fs12.mkdir(domainDir(home, opts.domain), { recursive: true });
    for (const name of stagedNames) {
      if (!isSafeSkillName(name)) {
        report.failed.push({ name, error: `unsafe staged skill name ${JSON.stringify(name)}` });
        continue;
      }
      const meta = upstreamLock?.skills?.[name];
      const hash = typeof meta?.computedHash === "string" ? meta.computedHash : "";
      if (!hash) {
        report.failed.push({
          name,
          error: "upstream lock has no computedHash for this skill (refusing to install untracked content)"
        });
        continue;
      }
      try {
        const replaced = await relocateSkillInto(
          path8.join(staging, ".agents", "skills", name),
          domainDir(home, opts.domain),
          name,
          now
        );
        report.installed.push({ name, hash, replaced });
      } catch (error) {
        report.failed.push({ name, error: error.message });
      }
    }
    return report;
  } finally {
    await fs12.rm(staging, { recursive: true, force: true }).catch(() => void 0);
  }
}
async function readUpstreamLock(staging) {
  const file = path8.join(staging, "skills-lock.json");
  let text2;
  try {
    text2 = await fs12.readFile(file, "utf8");
  } catch (error) {
    const code = error.code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
  try {
    const parsed = JSON.parse(text2);
    if (typeof parsed === "object" && parsed !== null) return parsed;
    return null;
  } catch {
    return null;
  }
}
async function enumerateStagedSkills(staging) {
  try {
    const entries = await fs12.readdir(path8.join(staging, ".agents", "skills"), {
      withFileTypes: true
    });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
function buildLockEntry(source, meta, hash, now) {
  const sourceType = typeof meta?.sourceType === "string" && meta.sourceType.length > 0 ? meta.sourceType : inferSourceType(source);
  const entry = { sourceType, hash, installedAt: now.toISOString() };
  if (typeof meta?.sourceUrl === "string" && meta.sourceUrl.length > 0) entry.sourceUrl = meta.sourceUrl;
  if (typeof meta?.resolvedRef === "string" && meta.resolvedRef.length > 0) entry.resolvedRef = meta.resolvedRef;
  if (typeof meta?.skillPath === "string" && meta.skillPath.length > 0) entry.skillPath = meta.skillPath;
  if (sourceType === "local") {
    entry.path = source;
  } else {
    entry.source = source;
  }
  if (meta) {
    const denylist = ["source", "sourceType", "sourceUrl", "resolvedRef", "computedHash", "skillPath", "path", "installedAt"];
    for (const [key, value] of Object.entries(meta)) {
      if (!denylist.includes(key)) {
        entry[key] = value;
      }
    }
  }
  return entry;
}
function inferSourceType(source) {
  if (/^[a-zA-Z]:[\\/]/.test(source) || source.startsWith("/") || source.startsWith("\\") || source.startsWith(".")) {
    return "local";
  }
  return "git";
}
async function relocateSkill(stagedSkill, home, role, name, now) {
  return relocateSkillInto(stagedSkill, roleSkillsDir(home, role), name, now);
}
async function relocateSkillInto(stagedSkill, skillsContainer, name, now) {
  const dest = path8.join(skillsContainer, name);
  const existed = await pathExists(dest);
  let backup;
  if (existed) {
    backup = path8.join(skillsContainer, backupName(name, now));
    await fs12.rename(dest, backup);
  }
  try {
    await relocateDir(stagedSkill, dest);
  } catch (error) {
    await fs12.rm(dest, { recursive: true, force: true }).catch(() => void 0);
    if (backup) {
      await fs12.rename(backup, dest).catch(() => {
        throw new NeoError(
          "failure",
          `install failed (${error.message}); original kept as backup: ${path8.basename(backup)}`
        );
      });
    }
    throw error;
  }
  if (backup) {
    await fs12.rm(backup, { recursive: true, force: true }).catch(() => void 0);
  }
  return existed;
}
async function relocateDir(from, to) {
  try {
    await fs12.rename(from, to);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    await fs12.cp(from, to, { recursive: true });
    await fs12.rm(from, { recursive: true, force: true });
  }
}
async function makeStaging(ports) {
  return fs12.mkdtemp(path8.join(ports.stagingRoot ?? os.tmpdir(), "neo-staging-"));
}
var ANSI_ESCAPE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
var NOISE_LINE = /^(npm (notice|warn|error code|error syscall)|Tip: use the --yes|\|?\s*$|─+$)/i;
var ERROR_LINE = /failed|failure|error|EPERM|ENOENT|SKILLS_|unable|denied|fatal|cannot|not found|unsupported|missing/i;
function summarizeUpstreamFailure(result) {
  const raw = [result.stdout, result.stderr].filter((text2) => text2.trim().length > 0).join("\n");
  const lines = raw.replace(ANSI_ESCAPE, "").replace(/\r/g, "").split("\n").map((line) => line.trim()).filter((line) => line.length > 0 && !NOISE_LINE.test(line));
  const interesting = lines.filter((line) => ERROR_LINE.test(line));
  const picked = (interesting.length > 0 ? interesting : lines.slice(-3)).slice(0, 3).map((line) => line.slice(0, 160));
  const detail = picked.join(" | ");
  const gitHint = /SKILLS_GIT_CLONE_FAILED|Failed to clone|spawn EPERM|spawn ENOENT/i.test(raw) ? " (hint: git clone failed to start; make sure `git --version` works from the same shell and git.exe is on PATH)" : "";
  return `upstream install failed (exit ${result.code})${detail ? `: ${detail}` : ""}${gitHint}`;
}

// packages/core/src/exec-node.ts
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import fs13 from "node:fs/promises";
import path9 from "node:path";
var DEFAULT_TIMEOUT_MS = 10 * 6e4;
var MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
async function findWindowsShim(name, env) {
  const exts = (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter((ext) => ext.length > 0).map((ext) => ext.toLowerCase());
  for (const dir of (env.PATH ?? "").split(";")) {
    if (dir.length === 0) continue;
    for (const ext of exts) {
      const candidate = path9.join(dir, `${name}${ext}`);
      try {
        const stat = await fs13.stat(candidate);
        if (stat.isFile()) return candidate;
      } catch {
      }
    }
  }
  return null;
}
async function resolveWindowsShim(command) {
  const name = command[0];
  const shim = /[\\/]/.test(name) || /\.(cmd|bat)$/i.test(name) ? name : await findWindowsShim(name, process.env);
  if (shim === null || !/\.(cmd|bat)$/i.test(shim)) return null;
  let text2;
  try {
    text2 = await fs13.readFile(shim, "utf8");
  } catch {
    return null;
  }
  const matches = [
    ...text2.matchAll(/%~dp0[\\/](node_modules[\\/][^"%\r\n]+?\.(?:js|exe))/gi)
  ].map((match) => match[1]);
  const preferred = matches.find((item) => new RegExp(`(^|[\\\\/])${name}-cli\\.js$`, "i").test(item)) ?? matches[matches.length - 1];
  const relative = preferred;
  if (relative === void 0) return null;
  const target = path9.join(path9.dirname(shim), relative);
  try {
    const stat = await fs13.stat(target);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }
  if (target.toLowerCase().endsWith(".js")) {
    const localNode = path9.join(path9.dirname(shim), "node.exe");
    const nodeExe = (await fs13.stat(localNode).catch(() => null))?.isFile() ? localNode : process.execPath;
    return { command: nodeExe, args: [target, ...command.slice(1)], shell: false };
  }
  return { command: target, args: [...command.slice(1)], shell: false };
}
async function windowsInvocation(command) {
  const resolved = await resolveWindowsShim(command);
  if (resolved !== null) return resolved;
  const first = command[0];
  const looksExecutable = /\.(exe|com)$/i.test(first);
  if (looksExecutable) {
    return { command: first, args: command.slice(1), shell: false };
  }
  return { command: command.map(quoteForWindowsShell).join(" "), args: [], shell: true };
}
var gitDirPromise;
async function resolveGitDir(isWindows2) {
  const dirs = (process.env.PATH ?? "").split(path9.delimiter).map((dir) => dir.replace(/^"|"$/g, "")).filter((dir) => dir.length > 0);
  for (const dir of dirs) {
    const candidate = path9.join(dir, isWindows2 ? "git.exe" : "git");
    try {
      const stat = await fs13.stat(candidate);
      if (!stat.isFile()) continue;
      if (!isWindows2) await fs13.access(candidate, fsConstants.X_OK);
      return dir;
    } catch {
    }
  }
  return void 0;
}
function nodeExecPort() {
  const isWindows2 = process.platform === "win32";
  return {
    async run(command, opts) {
      if (command.length === 0) throw new Error("nodeExecPort: empty command");
      const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const invocation = isWindows2 ? await windowsInvocation(command) : { command: command[0], args: command.slice(1), shell: false };
      gitDirPromise ??= resolveGitDir(isWindows2);
      const gitDir = await gitDirPromise;
      const childEnv = gitDir === void 0 ? process.env : {
        ...process.env,
        PATH: `${gitDir}${path9.delimiter}${process.env.PATH ?? ""}`
      };
      return new Promise((resolve, reject) => {
        const child = invocation.shell ? spawn(invocation.command, {
          cwd: opts.cwd,
          env: childEnv,
          shell: true,
          stdio: ["ignore", "pipe", "pipe"]
        }) : spawn(invocation.command, invocation.args, {
          cwd: opts.cwd,
          env: childEnv,
          stdio: ["ignore", "pipe", "pipe"]
        });
        const outDec = new StringDecoder("utf8");
        const errDec = new StringDecoder("utf8");
        let stdout2 = "";
        let stderr = "";
        let totalBytes = 0;
        let settled = false;
        const killTree = () => {
          if (isWindows2 && child.pid !== void 0) {
            spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }).on(
              "error",
              () => child.kill("SIGKILL")
            );
          } else {
            child.kill("SIGTERM");
            setTimeout(() => child.kill("SIGKILL"), 2e3).unref();
          }
        };
        const timer = setTimeout(() => {
          if (settled) return;
          killTree();
          finish(
            () => reject(new Error(`upstream command timed out after ${timeoutMs}ms: ${command.join(" ")}`))
          );
        }, timeoutMs);
        const finish = (fn) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          fn();
        };
        child.stdout?.on("data", (chunk) => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_OUTPUT_BYTES) {
            killTree();
            finish(() => reject(new Error(`upstream output exceeded ${MAX_OUTPUT_BYTES} bytes`)));
            return;
          }
          stdout2 += outDec.write(chunk);
        });
        child.stderr?.on("data", (chunk) => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_OUTPUT_BYTES) {
            killTree();
            finish(() => reject(new Error(`upstream output exceeded ${MAX_OUTPUT_BYTES} bytes`)));
            return;
          }
          stderr += errDec.write(chunk);
        });
        child.on("error", (error) => finish(() => reject(error)));
        child.on("close", (code) => {
          stdout2 += outDec.end();
          stderr += errDec.end();
          finish(() => resolve({ code: code ?? -1, stdout: stdout2, stderr }));
        });
      });
    }
  };
}
function quoteForWindowsShell(arg) {
  if (arg.includes('"')) {
    throw new Error(`nodeExecPort: argument contains a double quote, unsupported: ${arg}`);
  }
  if (!/[\s&|<>^%]/.test(arg)) return arg;
  const escaped = arg.replace(/(\\+)$/, "$1$1");
  return `"${escaped}"`;
}

// packages/core/src/git-sync.ts
import fs14 from "node:fs/promises";
import path10 from "node:path";
var GITIGNORE = [
  "/*",
  "!/.gitignore",
  "!/.gitattributes",
  "!/roles/",
  "!/library/",
  "!/state/",
  "/state/*",
  "!/state/locks/",
  "/state/locks/.*.tmp",
  "**/*.bak-*",
  "**/*.sync-conflict-*",
  "**/*conflicted copy*",
  "**/.stversions/",
  "**/node_modules/",
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
  "**/*.icloud",
  ".env",
  ".env.*",
  "**/*.pem",
  "**/*.key",
  ""
].join("\n");
var GITATTRIBUTES = [
  "* text=auto eol=lf",
  "*.bat text eol=crlf",
  "*.cmd text eol=crlf",
  "*.ps1 text eol=crlf",
  "/roles/** -text",
  "/library/** -text",
  "/state/locks/*.yaml text eol=lf",
  "*.png binary",
  "*.jpg binary",
  "*.jpeg binary",
  "*.gif binary",
  "*.webp binary",
  "*.ico binary",
  "*.pdf binary",
  "*.zip binary",
  "*.gz binary",
  "*.woff2 binary",
  "*.ttf binary",
  "*.node binary",
  ""
].join("\n");
async function pathIsFileOrDir(target) {
  try {
    await fs14.stat(target);
    return true;
  } catch {
    return false;
  }
}
async function detectRepoScope(home) {
  if (await pathIsFileOrDir(path10.join(home, ".git"))) return "home";
  let dir = path10.dirname(home);
  while (true) {
    if (await pathIsFileOrDir(path10.join(dir, ".git"))) return "parent";
    const parent = path10.dirname(dir);
    if (parent === dir) return "none";
    dir = parent;
  }
}
async function ensureSyncFiles(home) {
  await fs14.mkdir(home, { recursive: true });
  const written = [];
  const existing = [];
  for (const [name, content] of [
    [".gitignore", GITIGNORE],
    [".gitattributes", GITATTRIBUTES]
  ]) {
    const file = path10.join(home, name);
    if (await pathIsFileOrDir(file)) {
      existing.push(name);
      continue;
    }
    await fs14.writeFile(file, content, "utf8");
    written.push(name);
  }
  return { written, existing };
}
async function gitAvailable(exec2, cwd) {
  try {
    const result = await exec2.run(["git", "--version"], { cwd });
    return result.code === 0;
  } catch {
    return false;
  }
}
function validateRemoteUrl(remote) {
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/@]+:[^/@]+@/i.test(remote)) {
    throw new NeoError(
      "usage",
      "remote URL must not embed credentials (user:pass@); use SSH or a credential helper"
    );
  }
}
async function gitSync(home, opts) {
  const scope = await detectRepoScope(home);
  if (scope !== "none") {
    return {
      scope,
      files: { written: [], existing: [] },
      repoCreated: false,
      remoteAdded: false,
      warnings: []
    };
  }
  const files = await ensureSyncFiles(home);
  if (opts.remote.length === 0) {
    return {
      scope,
      files,
      repoCreated: false,
      remoteAdded: false,
      warnings: [],
      next: 'add a remote and run "git init" when ready (the ignore files are already in place)'
    };
  }
  validateRemoteUrl(opts.remote);
  const warnings = [];
  if (!await gitAvailable(opts.exec, home)) {
    warnings.push("git is not runnable from neo; install Git and ensure git.exe is on PATH");
    return { scope, files, repoCreated: false, remoteAdded: false, warnings };
  }
  const run = async (args) => {
    try {
      const result = await opts.exec.run(args, { cwd: home });
      if (result.code !== 0) {
        warnings.push(`${args.slice(0, 3).join(" ")} failed (exit ${result.code}): ${(result.stderr || result.stdout).trim().slice(0, 200)}`);
        return false;
      }
      return true;
    } catch (error) {
      warnings.push(`${args.slice(0, 3).join(" ")} could not start: ${error.message}`);
      return false;
    }
  };
  if (!await run(["git", "init"])) {
    return { scope, files, repoCreated: false, remoteAdded: false, warnings };
  }
  await run(["git", "add", "-A"]);
  if (!await run(["git", "commit", "-m", "neo: initialize home"])) {
    warnings.push("initial commit failed; configure git user.name/user.email, then commit manually");
  }
  const remoteAdded = await run(["git", "remote", "add", "origin", opts.remote]);
  return {
    scope,
    files,
    repoCreated: true,
    remoteAdded,
    warnings,
    ...remoteAdded ? { next: "git push -u origin HEAD" } : {}
  };
}

// packages/core/src/classify.ts
import path11 from "node:path";
var MAX_LINK_HOPS = 40;
function normalizeLinkTarget(raw) {
  if (process.platform !== "win32") return raw;
  let value = raw;
  if (/^\\\\\?\\UNC\\/i.test(value)) value = `\\\\${value.slice(8)}`;
  value = value.replace(/^\\\\\?\\/i, "").replace(/^\\\?\?\\/, "").replace(/^\\\\.\\/, "");
  return value;
}
function caseFoldPath(value) {
  return process.platform === "win32" || process.platform === "darwin" ? path11.resolve(value).toLowerCase() : path11.resolve(value);
}
var samePath = (a2, b) => caseFoldPath(a2) === caseFoldPath(b);
function isInsidePath(base, target) {
  const b = caseFoldPath(base);
  const t2 = caseFoldPath(target);
  return t2 === b || t2.startsWith(b + path11.sep);
}
async function resolveLinkTarget(port, slot) {
  let current = slot;
  for (let hop = 0; hop < MAX_LINK_HOPS; hop++) {
    const raw = await port.readlink(current);
    const resolved = path11.resolve(path11.dirname(current), normalizeLinkTarget(raw));
    const info = await port.lstat(resolved);
    if (info === null) return { final: resolved, exists: false, broken: "missing" };
    if (!info.symlink) return { final: resolved, exists: true };
    current = resolved;
  }
  return { final: current, exists: false, broken: "cycle" };
}
async function classifySlot(port, input) {
  const info = await port.lstat(input.slot);
  if (info === null) return { kind: "empty" };
  if (!info.symlink) {
    return { kind: "F", real: info.directory ? "dir" : "file" };
  }
  if (input.recorded) return { kind: "A" };
  const resolution = await resolveLinkTarget(port, input.slot);
  if (!resolution.exists) {
    return {
      kind: "E",
      resolvedTarget: resolution.final,
      ...resolution.broken !== void 0 ? { broken: resolution.broken } : {}
    };
  }
  if (isInsidePath(input.home, resolution.final)) {
    return { kind: "B", resolvedTarget: resolution.final };
  }
  if (input.registryDirs.some((dir) => isInsidePath(dir, resolution.final))) {
    return { kind: "C", resolvedTarget: resolution.final };
  }
  return { kind: "D", resolvedTarget: resolution.final };
}

// packages/core/src/link-node.ts
import fs15 from "node:fs/promises";
var isMissing = (error) => {
  const code = error?.code;
  return code === "ENOENT" || code === "ENOTDIR";
};
function nodeLinkPort() {
  const isWindows2 = process.platform === "win32";
  return {
    async lstat(path27) {
      try {
        const stat = await fs15.lstat(path27);
        return { symlink: stat.isSymbolicLink(), directory: stat.isDirectory(), file: stat.isFile() };
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    readlink(path27) {
      return fs15.readlink(path27);
    },
    linkDir(target, linkPath) {
      return fs15.symlink(target, linkPath, isWindows2 ? "junction" : "dir");
    },
    async unlink(path27) {
      try {
        await fs15.unlink(path27);
      } catch (error) {
        const code = error?.code;
        if (isWindows2 && (code === "EPERM" || code === "EISDIR")) {
          const stat = await fs15.lstat(path27).catch(() => null);
          if (stat?.isSymbolicLink() === true) {
            await fs15.rmdir(path27);
            return;
          }
        }
        throw error;
      }
    }
  };
}

// packages/core/src/mounts.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import fs16 from "node:fs/promises";
import path12 from "node:path";
function emptyMounts() {
  return { version: 1, targets: {} };
}
function invalid5(message) {
  return new NeoError("state", `state/mounts.json: ${message}`);
}
async function readMounts(home) {
  let text2;
  try {
    text2 = await fs16.readFile(mountsJsonPath(home), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return emptyMounts();
    throw error;
  }
  let raw;
  try {
    raw = JSON.parse(text2);
  } catch (error) {
    throw invalid5(`not valid JSON (${error.message})`);
  }
  if (!isRecord(raw)) throw invalid5("expected a top-level object");
  if (raw.version === void 0) throw invalid5('missing required field "version"');
  if (raw.version !== 1) {
    throw invalid5(
      `unsupported version ${String(raw.version)} (supported major version: 1; refusing to read or write)`
    );
  }
  if (raw.targets === void 0) throw invalid5('missing required field "targets"');
  if (!isRecord(raw.targets)) throw invalid5('"targets" must be an object keyed by absolute path');
  const targets = {};
  for (const [dir, value] of Object.entries(raw.targets)) {
    if (!isRecord(value)) throw invalid5(`targets["${dir}"] must be an object`);
    if (typeof value.agent !== "string" || value.agent.length === 0) {
      throw invalid5(`targets["${dir}"] is missing required string field "agent"`);
    }
    if (!Array.isArray(value.skills)) {
      throw invalid5(`targets["${dir}"].skills must be an array of skill names`);
    }
    if (value.skills.some((name) => typeof name !== "string")) {
      throw invalid5(`targets["${dir}"].skills must be an array of skill names`);
    }
    targets[dir] = value;
  }
  return { ...raw, version: 1, targets };
}
async function writeMounts(home, ledger) {
  const file = mountsJsonPath(home);
  await fs16.mkdir(stateDir(home), { recursive: true });
  const tmp = path12.join(stateDir(home), `.${path12.basename(file)}.${randomUUID3()}.tmp`);
  try {
    await fs16.writeFile(tmp, `${JSON.stringify(ledger, null, 2)}
`, "utf8");
    await fs16.rename(tmp, file);
  } finally {
    await fs16.rm(tmp, { recursive: true, force: true }).catch(() => void 0);
  }
}

// packages/core/src/targets.ts
import path13 from "node:path";
async function readRegistry(home) {
  const extension = await readAgentsExtension(home);
  return mergeRegistry(BUILTIN_AGENTS, extension?.agents ?? {});
}
function resolveDirValue(value, homedir, kind, what) {
  const expanded = expandTilde(value, homedir);
  if (!path13.isAbsolute(expanded)) {
    throw new NeoError(
      kind,
      `${what} must resolve to an absolute path after ~ expansion, got: ${JSON.stringify(value)}`
    );
  }
  return path13.resolve(expanded);
}
function registrySkillDirs(registry, homedir) {
  const dirs = [];
  for (const entry of registry) {
    const expanded = expandTilde(entry.skillsDir, homedir);
    if (path13.isAbsolute(expanded)) dirs.push(path13.resolve(expanded));
  }
  return dirs;
}
function resolveOne(entry, target, homedir) {
  const raw = target.skillsDir ?? entry.skillsDir;
  return {
    agent: target.agent,
    skillsDir: resolveDirValue(raw, homedir, "state", `target "${target.agent}" skillsDir`),
    agentsMd: target.agentsMd ?? false
  };
}
async function resolveTargets(home, homedir, targets) {
  const registry = await readRegistry(home);
  const resolved = [];
  const byDir = /* @__PURE__ */ new Map();
  for (const target of targets) {
    const entry = registry.find((candidate) => candidate.id === target.agent);
    if (entry === void 0) {
      throw new NeoError(
        "state",
        `config target "${target.agent}" is not in the merged registry; fix config.yaml or add an agents.yaml entry`
      );
    }
    const one = resolveOne(entry, target, homedir);
    const key = caseFoldPath(one.skillsDir);
    const owner = byDir.get(key);
    if (owner !== void 0) {
      throw new NeoError(
        "state",
        `targets "${owner}" and "${one.agent}" resolve to the same skills directory: ${one.skillsDir}; keep only one`
      );
    }
    byDir.set(key, one.agent);
    resolved.push(one);
  }
  return resolved;
}
async function addTarget(home, homedir, id, opts = {}) {
  const registry = await readRegistry(home);
  const entry = registry.find((candidate) => candidate.id === id);
  if (entry === void 0) {
    const known = registry.map((candidate) => candidate.id).join(", ");
    throw new NeoError("usage", `unknown agent id "${id}" (known ids: ${known})`);
  }
  const loaded = await readConfig(home);
  if (loaded.config.targets.some((target2) => target2.agent === id)) {
    throw new NeoError(
      "state",
      `target "${id}" is already configured (run: neo target remove ${id} first)`
    );
  }
  const rawDir = opts.skillsDir ?? entry.skillsDir;
  const kind = opts.skillsDir !== void 0 ? "usage" : "state";
  const dir = resolveDirValue(rawDir, homedir, kind, `--skills-dir for "${id}"`);
  const existing = await resolveTargets(home, homedir, loaded.config.targets);
  const clash = existing.find((target2) => caseFoldPath(target2.skillsDir) === caseFoldPath(dir));
  if (clash !== void 0) {
    throw new NeoError(
      "state",
      `"${id}" resolves to the same skills directory as target "${clash.agent}": ${dir}; keep only one`
    );
  }
  const target = { agent: id };
  if (opts.skillsDir !== void 0) target.skillsDir = opts.skillsDir;
  if (opts.agentsMd) target.agentsMd = true;
  loaded.config.targets = [...loaded.config.targets, target];
  await writeConfig(home, loaded);
  return { agent: id, skillsDir: dir, agentsMd: opts.agentsMd ?? false };
}
async function removeTarget(home, homedir, id) {
  const loaded = await readConfig(home);
  const target = loaded.config.targets.find((candidate) => candidate.agent === id);
  if (target === void 0) {
    throw new NeoError("state", `target "${id}" is not configured`);
  }
  let dir = null;
  try {
    dir = (await resolveTargets(home, homedir, [target]))[0]?.skillsDir ?? null;
  } catch {
    dir = null;
  }
  const ledger = await readMounts(home);
  const stillRecorded = dir !== null && ledger.targets[dir] !== void 0 || Object.values(ledger.targets).some((entry) => entry.agent === id);
  loaded.config.targets = loaded.config.targets.filter((candidate) => candidate.agent !== id);
  await writeConfig(home, loaded);
  return { dir, stillRecorded };
}
async function listConfiguredTargets(home, homedir) {
  const { config } = await readConfig(home);
  return resolveTargets(home, homedir, config.targets);
}

// packages/core/src/converge.ts
import fs18 from "node:fs/promises";
import path15 from "node:path";

// packages/core/src/agentsmd.ts
import path14 from "node:path";
import { randomUUID as randomUUID4 } from "node:crypto";
import fs17 from "node:fs/promises";
var BEGIN_LINE = /^<!--\s*neo:begin\s+role=([^\s>]+)\s*-->\r?$/;
var END_LINE = /^<!--\s*neo:end\s+role=([^\s>]+)\s*-->\r?$/;
var PROJECT_BEGIN_LINE = /^<!--\s*neo:project:begin\s+role=([^\s>]+)\s*-->\r?$/;
var PROJECT_END_LINE = /^<!--\s*neo:project:end\s+role=([^\s>]+)\s*-->\r?$/;
var NEO_MARKER_LINE = /^<!--\s*neo:(?:project:)?(?:begin|end)\b.*-->\r?$/;
function assertNoNeoMarkerLines(role, content) {
  const line = content.split(/\r?\n/).find((l) => NEO_MARKER_LINE.test(l));
  if (line !== void 0) {
    throw new NeoError(
      "usage",
      `role "${role}" prompt contains a reserved neo block marker; remove this line: ${line.trim()}`
    );
  }
}
function renderNeoBlock(role, content) {
  return `<!-- neo:begin role=${role} -->
${content.replace(/\s+$/, "")}
<!-- neo:end role=${role} -->
`;
}
function renderProjectBlock(role, content) {
  return `<!-- neo:project:begin role=${role} -->
${content.replace(/\s+$/, "")}
<!-- neo:project:end role=${role} -->
`;
}
function containsNeoBlocks(content) {
  return content.split("\n").some((line) => BEGIN_LINE.test(line));
}
function containsProjectBlocks(content) {
  return content.split("\n").some((line) => PROJECT_BEGIN_LINE.test(line));
}
function stripMarkedBlocks(content, beginLine, endLine) {
  let out = "";
  let i2 = 0;
  let removed = 0;
  while (i2 < content.length) {
    const lineEnd = content.indexOf("\n", i2);
    const line = lineEnd === -1 ? content.slice(i2) : content.slice(i2, lineEnd);
    if (beginLine.test(line)) {
      let j = lineEnd === -1 ? content.length : lineEnd + 1;
      let matchedEnd = -1;
      while (j < content.length) {
        const innerEnd = content.indexOf("\n", j);
        const inner = innerEnd === -1 ? content.slice(j) : content.slice(j, innerEnd);
        if (endLine.test(inner)) {
          matchedEnd = innerEnd === -1 ? content.length : innerEnd + 1;
          break;
        }
        j = innerEnd === -1 ? content.length : innerEnd + 1;
      }
      if (matchedEnd === -1) {
        out += lineEnd === -1 ? line : `${line}
`;
        i2 = lineEnd === -1 ? content.length : lineEnd + 1;
        continue;
      }
      removed++;
      i2 = matchedEnd;
      continue;
    }
    out += lineEnd === -1 ? line : `${line}
`;
    i2 = lineEnd === -1 ? content.length : lineEnd + 1;
  }
  return { content: out, removed };
}
function stripNeoBlocks(content) {
  return stripMarkedBlocks(content, BEGIN_LINE, END_LINE);
}
function stripProjectBlocks(content) {
  return stripMarkedBlocks(content, PROJECT_BEGIN_LINE, PROJECT_END_LINE);
}
function applyMarkedBlocks(content, blocks, marker) {
  const { content: stripped, removed } = marker.strip(content);
  if (blocks.length === 0) {
    return { content: stripped, changed: removed > 0 };
  }
  if (stripped.length > 0 && !stripped.endsWith("\n")) {
    const withNewline = `${stripped}
${blocks.map((block2) => marker.render(block2.role, block2.content)).join("")}`;
    return { content: withNewline, changed: true };
  }
  const next = stripped + blocks.map((block2) => marker.render(block2.role, block2.content)).join("");
  return { content: next, changed: next !== content || removed !== blocks.length };
}
function applyNeoBlocks(content, blocks) {
  return applyMarkedBlocks(content, blocks, { render: renderNeoBlock, strip: stripNeoBlocks });
}
function applyProjectBlocks(content, blocks) {
  return applyMarkedBlocks(content, blocks, { render: renderProjectBlock, strip: stripProjectBlocks });
}
function isEmptyPrompt(content, role) {
  const trimmed = content.trim();
  if (trimmed.length === 0) return true;
  return trimmed === roleAgentsMdStub(role).trim();
}
function planAgentsMdTargets(targets, registry, homedir) {
  const byAgent = /* @__PURE__ */ new Map();
  const errors = /* @__PURE__ */ new Map();
  const byFile = /* @__PURE__ */ new Map();
  const drafts = [];
  for (const target of targets) {
    if (!target.agentsMd) continue;
    const entry = registry.find((candidate) => candidate.id === target.agent);
    if (entry === void 0) continue;
    const raw = entry.agentsMd;
    if (raw === void 0) {
      errors.set(
        target.agent,
        `agent "${target.agent}" has no user-level instruction file in the registry; remove its agentsMd opt-in (or remap the agent in agents.yaml)`
      );
      continue;
    }
    const expanded = expandTilde(raw, homedir);
    if (!path14.isAbsolute(expanded)) {
      errors.set(
        target.agent,
        `agentsMd path for "${target.agent}" must resolve to an absolute path after ~ expansion, got: ${JSON.stringify(raw)}`
      );
      continue;
    }
    drafts.push({ agent: target.agent, file: path14.resolve(expanded), rawPath: raw });
  }
  for (const draft of drafts) {
    const key = caseFoldPath(draft.file);
    const owner = byFile.get(key);
    if (owner !== void 0) {
      const message = `agentsMd conflict: targets "${owner}" and "${draft.agent}" resolve to the same instruction file: ${draft.file}; converge to one target`;
      errors.set(draft.agent, message);
      errors.set(owner, message);
      byAgent.delete(owner);
      continue;
    }
    byFile.set(key, draft.agent);
    byAgent.set(draft.agent, draft);
  }
  return { byAgent, errors };
}
async function readRolePrompt(home, role) {
  try {
    return await fs17.readFile(roleAgentsMd(home, role), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function desiredPromptBlocks(home, role) {
  if (role === null) return [];
  const blocks = [];
  for (const sourceRole of role === "default" ? ["default"] : ["default", role]) {
    const content = await readRolePrompt(home, sourceRole);
    if (content !== null && !isEmptyPrompt(content, sourceRole)) {
      assertNoNeoMarkerLines(sourceRole, content);
      blocks.push({ role: sourceRole, content });
    }
  }
  return blocks;
}
function asAgentsMdLedger(previous) {
  if (!isRecord(previous) || previous.mounted !== true || typeof previous.file !== "string") {
    return void 0;
  }
  const entry = { ...previous, mounted: true, file: previous.file };
  if (typeof previous.backup === "string") entry.backup = previous.backup;
  return entry;
}
function backupRelPath(agent, file) {
  const safeAgent = safeBackupAgentName(agent);
  return path14.join("state", "backups", `${safeAgent}-${path14.basename(file)}.bak`).split(path14.sep).join("/");
}
async function pathExists2(target) {
  return pathExists(target);
}
async function writeFileAtomic2(file, content) {
  await writeFileAtomic(file, content, { defaultMode: 420 });
}
async function backupFileAtomic(from, to) {
  await fs17.mkdir(path14.dirname(to), { recursive: true });
  const tmp = `${to}.${randomUUID4()}.tmp`;
  try {
    await fs17.copyFile(from, tmp);
    await fs17.rename(tmp, to);
  } finally {
    await fs17.rm(tmp, { force: true }).catch(() => void 0);
  }
}
async function pushOverrideWarning(warnings, resolved, role) {
  if (role === null) return;
  if (resolved.agent !== "codex" || path14.basename(resolved.file) !== "AGENTS.md") return;
  const override = path14.join(path14.dirname(resolved.file), "AGENTS.override.md");
  if (!await pathExists2(override)) return;
  warnings.push(`AGENTS.override.md exists (${override}); the mounted ${resolved.file} is not read by codex`);
}
async function convergeAgentsMdFile(home, resolved, role, previous) {
  const actions = [];
  const warnings = [];
  const prevEntry = asAgentsMdLedger(previous);
  try {
    const desired = await desiredPromptBlocks(home, role);
    let content;
    try {
      content = await fs17.readFile(resolved.file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") content = null;
      else throw error;
    }
    const hasBlocks = content !== null && containsNeoBlocks(content);
    if (desired.length === 0 && !hasBlocks) {
      return { actions, warnings, accounting: null };
    }
    if (desired.length === 0) {
      const { content: userPart } = stripNeoBlocks(content ?? "");
      if (userPart.trim() === "" && prevEntry?.backup === void 0) {
        await fs17.rm(resolved.file, { force: true });
        actions.push({ kind: "file-removed", file: resolved.file });
      } else {
        await writeFileAtomic2(resolved.file, userPart.trim() === "" ? "" : userPart);
        actions.push({ kind: "stripped", file: resolved.file });
      }
      return { actions, warnings, accounting: null };
    }
    const next = applyNeoBlocks(content ?? "", desired);
    if (!next.changed) {
      await pushOverrideWarning(warnings, resolved, role);
      return {
        actions,
        warnings,
        accounting: prevEntry ?? { mounted: true, file: resolved.rawPath }
      };
    }
    let backupRel = prevEntry?.backup;
    let backupNote;
    if (content !== null && backupRel === void 0) {
      backupRel = backupRelPath(resolved.agent, resolved.file);
      const bakAbs = path14.join(home, ...backupRel.split("/"));
      if (!await pathExists2(bakAbs)) {
        await backupFileAtomic(resolved.file, bakAbs);
        backupNote = `first-touch backup -> ${backupRel}`;
      }
    }
    await writeFileAtomic2(resolved.file, next.content);
    actions.push({
      kind: hasBlocks ? "updated" : "mounted",
      file: resolved.file,
      ...backupNote !== void 0 ? { note: backupNote } : {}
    });
    const accounting = {
      ...prevEntry ?? {},
      mounted: true,
      file: resolved.rawPath,
      ...backupRel !== void 0 ? { backup: backupRel } : {}
    };
    await pushOverrideWarning(warnings, resolved, role);
    return { actions, warnings, accounting };
  } catch (error) {
    return { actions, warnings, accounting: null, error: error.message };
  }
}

// packages/core/src/converge.ts
async function desiredSkills(home, role) {
  const skills = /* @__PURE__ */ new Map();
  if (role !== null) {
    const { resolutions } = await resolveRoleAssembly(home, role);
    for (const [name, resolution] of resolutions) {
      skills.set(name, {
        name,
        sourceRole: layerLabel(resolution.winner),
        dir: resolution.winner.dir
      });
    }
  }
  const groups = /* @__PURE__ */ new Map();
  for (const name of skills.keys()) {
    const key = name.toLowerCase();
    groups.set(key, [...groups.get(key) ?? [], name]);
  }
  return {
    skills,
    caseCollisions: new Map([...groups].filter(([, names]) => names.length > 1))
  };
}
async function convergeOneTarget(ports, home, target, desired, ledger, opts) {
  const report = {
    agent: target.agent,
    dir: target.skillsDir,
    actions: [],
    conflicts: [],
    errors: [],
    agentsMd: [],
    warnings: []
  };
  const port = ports.link;
  try {
    await fs18.mkdir(target.skillsDir, { recursive: true });
  } catch (error) {
    report.errors.push({ skill: "(target)", error: `cannot create skills dir: ${error.message}` });
    return report;
  }
  const previous = ledger.targets[target.skillsDir];
  const recorded = new Set(previous?.skills ?? []);
  const finalSkills = /* @__PURE__ */ new Set();
  const stuckSkills = /* @__PURE__ */ new Set();
  for (const name of recorded) {
    if (desired.skills.has(name)) continue;
    const slot = path15.join(target.skillsDir, name);
    let info;
    try {
      info = await port.lstat(slot);
    } catch (error) {
      report.errors.push({ skill: name, error: `lstat failed: ${error.message}` });
      stuckSkills.add(name);
      continue;
    }
    if (info === null) continue;
    if (!info.symlink) {
      report.conflicts.push({
        skill: name,
        kind: "F",
        detail: `recorded slot is now unmanaged real content; left in place and dropped from ledger`
      });
      continue;
    }
    try {
      await port.unlink(slot);
      report.actions.push({ skill: name, kind: "removed" });
    } catch (error) {
      report.errors.push({ skill: name, error: `unlink failed: ${error.message}` });
      stuckSkills.add(name);
    }
  }
  const wanted = [...desired.skills.values()].sort(
    (a2, b) => a2.name < b.name ? -1 : a2.name > b.name ? 1 : 0
  );
  for (const skill of wanted) {
    const { name, sourceRole } = skill;
    const collision = desired.caseCollisions.get(name.toLowerCase());
    if (collision !== void 0) {
      report.conflicts.push({
        skill: name,
        kind: "case",
        detail: `case-insensitive collision with [${collision.join(", ")}]; rename at role level`
      });
      continue;
    }
    const slot = path15.join(target.skillsDir, name);
    const source = skill.dir;
    const replace = async (note, kind) => {
      try {
        await port.unlink(slot);
        const sourceInfo = await port.lstat(source);
        if (sourceInfo === null) {
          report.errors.push({ skill: name, error: `skill source missing: ${source}` });
          return false;
        }
        await port.linkDir(source, slot);
        report.actions.push({
          skill: name,
          kind: kind ?? "repointed",
          sourceRole,
          ...note !== void 0 ? { note } : {}
        });
        return true;
      } catch (error) {
        report.errors.push({ skill: name, error: error.message });
        return false;
      }
    };
    let classification;
    try {
      classification = await classifySlot(port, {
        slot,
        recorded: recorded.has(name),
        home,
        registryDirs: opts.registryDirs
      });
    } catch (error) {
      report.errors.push({ skill: name, error: error.message });
      continue;
    }
    switch (classification.kind) {
      case "empty": {
        try {
          const sourceInfo = await port.lstat(source);
          if (sourceInfo === null) {
            report.errors.push({ skill: name, error: `skill source missing: ${source}` });
            break;
          }
          await port.linkDir(source, slot);
          report.actions.push({ skill: name, kind: "mounted", sourceRole });
          finalSkills.add(name);
        } catch (error) {
          report.errors.push({ skill: name, error: error.message });
        }
        break;
      }
      case "A": {
        let resolved = null;
        try {
          const raw = await port.readlink(slot);
          resolved = path15.resolve(path15.dirname(slot), normalizeLinkTarget(raw));
        } catch {
          resolved = null;
        }
        if (resolved !== null && samePath(resolved, source)) {
          finalSkills.add(name);
          break;
        }
        if (await replace()) finalSkills.add(name);
        break;
      }
      case "B": {
        if (await replace(void 0, "replaced-orphan")) finalSkills.add(name);
        break;
      }
      case "C": {
        if (await replace(`was -> ${classification.resolvedTarget}`, "replaced-mirror")) {
          finalSkills.add(name);
        }
        break;
      }
      case "D": {
        if (opts.force) {
          if (await replace(`was -> ${classification.resolvedTarget}`, "replaced-external")) {
            finalSkills.add(name);
          }
        } else {
          report.conflicts.push({
            skill: name,
            kind: "D",
            detail: `external link -> ${classification.resolvedTarget} (--force to replace)`
          });
        }
        break;
      }
      case "E": {
        if (opts.force) {
          if (await replace(`was -> ${classification.resolvedTarget}`, "replaced-broken")) {
            finalSkills.add(name);
          }
        } else {
          report.conflicts.push({
            skill: name,
            kind: "E",
            detail: `broken link (${classification.broken}) -> ${classification.resolvedTarget} (--force to replace)`
          });
        }
        break;
      }
      case "F": {
        report.conflicts.push({
          skill: name,
          kind: "F",
          detail: `unmanaged real ${classification.real}; never replaced (migrate owns absorbing it)`
        });
        break;
      }
    }
  }
  const planned = opts.agentsMdPlan.byAgent.get(target.agent);
  const planError = opts.agentsMdPlan.errors.get(target.agent);
  let agentsMdField = previous?.agentsMd;
  if (planError !== void 0) {
    report.errors.push({ skill: "(agents-md)", error: planError });
  } else if (planned !== void 0) {
    const result = await convergeAgentsMdFile(home, planned, opts.role, previous?.agentsMd);
    report.agentsMd.push(...result.actions);
    report.warnings.push(...result.warnings);
    if (result.error !== void 0) {
      report.errors.push({ skill: "(agents-md)", error: result.error });
    } else {
      agentsMdField = result.accounting === null ? void 0 : result.accounting;
    }
  }
  const skills = [...finalSkills, ...stuckSkills].sort();
  if (skills.length === 0 && agentsMdField === void 0) {
    delete ledger.targets[target.skillsDir];
  } else {
    const prev = ledger.targets[target.skillsDir];
    const entry = { ...prev, agent: target.agent, skills };
    if (agentsMdField === void 0) delete entry.agentsMd;
    else entry.agentsMd = agentsMdField;
    ledger.targets[target.skillsDir] = entry;
  }
  await writeMounts(home, ledger);
  if (opts.sweep) {
    const keep = new Set(skills);
    let entries;
    try {
      entries = await fs18.readdir(target.skillsDir);
    } catch (error) {
      report.errors.push({ skill: "(target)", error: `orphan sweep readdir failed: ${error.message}` });
      return report;
    }
    for (const name of entries) {
      if (keep.has(name)) continue;
      const slot = path15.join(target.skillsDir, name);
      const info = await port.lstat(slot);
      if (info === null || !info.symlink) continue;
      let pointsHome = false;
      try {
        const resolution = await resolveLinkTarget(port, slot);
        pointsHome = isInsidePath(home, resolution.final);
      } catch {
        pointsHome = false;
      }
      if (!pointsHome) continue;
      try {
        await port.unlink(slot);
        report.actions.push({ skill: name, kind: "swept-orphan" });
      } catch (error) {
        report.errors.push({ skill: name, error: `orphan sweep unlink failed: ${error.message}` });
      }
    }
  }
  return report;
}
async function converge(ports, home, homedir, role, opts = {}) {
  const loaded = await readConfig(home);
  const registry = await readRegistry(home);
  const targets = await resolveTargets(home, homedir, loaded.config.targets);
  const desired = await desiredSkills(home, role);
  const ledger = await readMounts(home);
  const agentsMdPlan = planAgentsMdTargets(targets, registry, homedir);
  const reports = [];
  for (const target of targets) {
    const report = await convergeOneTarget(ports, home, target, desired, ledger, {
      force: opts.force ?? false,
      sweep: role === null,
      role,
      registryDirs: registrySkillDirs(registry, homedir),
      agentsMdPlan
    });
    reports.push(report);
  }
  return {
    role,
    targets: reports,
    ok: reports.every((report) => report.conflicts.length === 0 && report.errors.length === 0)
  };
}
var queueTail = Promise.resolve();
function enqueue(operation) {
  const next = queueTail.then(operation, operation);
  queueTail = next.then(
    () => void 0,
    () => void 0
  );
  return next;
}
async function existsDir2(target) {
  try {
    const stat = await fs18.stat(target);
    return stat.isDirectory();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function useRole(ports, home, opts) {
  return enqueue(async () => {
    const loaded = await readConfig(home);
    let role = opts.role;
    if (role === void 0) {
      if (loaded.config.activeRole === null) {
        throw new NeoError("state", "no active role (config.activeRole is null); run: neo use <role>");
      }
      role = loaded.config.activeRole;
    } else {
      validateRoleName(role);
    }
    if (!await existsDir2(roleDir(home, role))) {
      throw new NeoError("state", `role "${role}" not found`);
    }
    loaded.config.activeRole = role;
    await writeConfig(home, loaded);
    const report = await converge(ports, home, opts.homedir, role, {
      ...opts.force !== void 0 ? { force: opts.force } : {}
    });
    if (report.ok) await clearLockDirty(home, role).catch(() => void 0);
    return report;
  });
}
async function offAll(ports, home, opts) {
  return enqueue(async () => {
    const loaded = await readConfig(home);
    loaded.config.activeRole = null;
    await writeConfig(home, loaded);
    return converge(ports, home, opts.homedir, null);
  });
}

// packages/core/src/roots.ts
import fs19 from "node:fs/promises";
import path16 from "node:path";
function entryFor(registry, agent) {
  const entry = registry.find((item) => item.id === agent);
  if (entry === void 0) {
    throw new NeoError("usage", `unknown agent "${agent}" (run: neo list agents)`);
  }
  return entry;
}
function isolationFor(entry) {
  const isolate = entry.isolate;
  if (isolate === void 0 || !isolate.supports.includes("launch")) {
    throw new NeoError(
      "state",
      `agent "${entry.id}" cannot be launched with neo run (${launchBlockReason(entry)}); see: neo list agents`
    );
  }
  return isolate;
}
async function listDirOrEmpty(dir) {
  try {
    const entries = await fs19.readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() || entry.isSymbolicLink());
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function desiredSkillSources(home, role) {
  const dirs = /* @__PURE__ */ new Map();
  const roles = /* @__PURE__ */ new Map();
  const { resolutions } = await resolveRoleAssembly(home, role);
  for (const [name, resolution] of resolutions) {
    dirs.set(name, resolution.winner.dir);
    roles.set(name, layerLabel(resolution.winner));
  }
  return { dirs, roles };
}
async function convergeSkillLinks(link, skillsRoot, desired) {
  await fs19.mkdir(skillsRoot, { recursive: true });
  const notes = [];
  const counts = { added: 0, kept: 0, removed: 0, replaced: 0 };
  const present = /* @__PURE__ */ new Set();
  for (const entry of await fs19.readdir(skillsRoot, { withFileTypes: true })) {
    const slot = path16.join(skillsRoot, entry.name);
    present.add(entry.name);
    const source = desired.get(entry.name);
    if (source === void 0) {
      const info2 = await link.lstat(slot);
      if (info2?.symlink === true) {
        await link.unlink(slot);
        counts.removed++;
      } else {
        notes.push(`left unmanaged entry in root: ${slot}`);
      }
      continue;
    }
    const info = await link.lstat(slot);
    if (info === null) continue;
    if (info.symlink !== true) {
      notes.push(`root slot is not a link (left untouched): ${slot}`);
      continue;
    }
    let raw = null;
    try {
      raw = await link.readlink(slot);
    } catch {
      raw = null;
    }
    const resolved = raw === null ? null : path16.resolve(path16.dirname(slot), normalizeLinkTarget(raw));
    if (resolved !== null && samePath(resolved, source)) {
      counts.kept++;
      continue;
    }
    await link.unlink(slot);
    await link.linkDir(source, slot);
    counts.replaced++;
  }
  for (const [name, source] of desired) {
    if (present.has(name)) continue;
    await link.linkDir(source, path16.join(skillsRoot, name));
    counts.added++;
  }
  return { ...counts, notes };
}
async function readTextIfExists(file) {
  try {
    return await fs19.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function ensureShareDirs(link, root, realRoot, dirs, notes) {
  const shared = [];
  for (const dir of dirs) {
    const source = path16.join(realRoot, dir);
    if (!await pathExists(source)) continue;
    const slot = path16.join(root, dir);
    const info = await link.lstat(slot);
    if (info === null) {
      await link.linkDir(source, slot);
      shared.push(dir);
      continue;
    }
    if (info.symlink === true) {
      const raw = await link.readlink(slot).catch(() => null);
      if (raw !== null && samePath(path16.resolve(path16.dirname(slot), normalizeLinkTarget(raw)), source)) {
        shared.push(dir);
        continue;
      }
      notes.push(`share dir link points elsewhere (left untouched): ${slot}`);
      continue;
    }
    notes.push(`share dir slot is a real directory (left untouched): ${slot}`);
  }
  return shared;
}
async function convergeRoot(ports, home, homedir, opts) {
  const registry = await readRegistry(home);
  const entry = entryFor(registry, opts.agent);
  const isolate = isolationFor(entry);
  const role = opts.role;
  if (role !== "default" && !await pathExists(roleDir(home, role))) {
    throw new NeoError("state", `role "${role}" not found`);
  }
  const root = opts.root ?? rootDir(home, role, opts.agent);
  await fs19.mkdir(root, { recursive: true });
  const { dirs: desired, roles: sourceRoles } = await desiredSkillSources(home, role);
  const skillResult = await convergeSkillLinks(
    ports.link,
    path16.join(root, isolate.skillsDir),
    desired
  );
  const notes = [...skillResult.notes];
  const blocks = await desiredPromptBlocks(home, role);
  const instructionText = blocks.map((block2) => block2.content.replace(/\s+$/, "")).filter((text2) => text2.length > 0).join("\n\n");
  const instructionFile = path16.join(root, isolate.instructionFile);
  if (instructionText.length > 0) {
    await writeFileAtomic(instructionFile, `${instructionText}
`);
  } else {
    await fs19.rm(instructionFile, { force: true });
  }
  const realRoot = expandTilde(isolate.homeDir, homedir);
  const auth = [];
  if (opts.skipAuth !== true) for (const file of isolate.authFiles ?? []) {
    const source = path16.join(realRoot, file);
    try {
      await fs19.copyFile(source, path16.join(root, file));
      if (process.platform !== "win32") {
        await fs19.chmod(path16.join(root, file), 384).catch(() => void 0);
      }
      auth.push(file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      notes.push(
        process.platform === "darwin" && opts.agent === "claude-code" ? `auth not found (${source}); on macOS Claude Code keeps credentials in the login Keychain \u2014 log in once in this root or set ANTHROPIC_AUTH_TOKEN` : `auth not found (login may be required): ${source}`
      );
    }
  }
  const shared = await ensureShareDirs(ports.link, root, realRoot, isolate.shareDirs ?? [], notes);
  const servers = mergeMcpServers(
    await readRoleMcp(home, "default"),
    await readRoleMcp(home, role)
  );
  const resolved = resolveMcpEnv(servers, opts.env ?? {}, opts.agent, opts.strictEnv !== false);
  const { config } = await readConfig(home);
  const roleSelection = await readRoleModels(home, role);
  const roleModels = {
    version: 1,
    providers: config.providers,
    ...roleSelection.default ?? config.defaultModel !== void 0 ? { default: roleSelection.default ?? config.defaultModel } : {}
  };
  const modelContent = opts.skipModels !== true && (Object.keys(roleModels.providers).length > 0 || roleModels.default !== void 0);
  if (isolate.models !== void 0 && modelContent) {
    resolveModelEnv(roleModels, opts.env ?? {}, opts.strictEnv !== false);
  }
  let mcpFile = null;
  let mcpWritten = false;
  if (isolate.mcp !== void 0) {
    const file = path16.join(root, isolate.mcp.file);
    mcpFile = file;
    switch (isolate.mcp.format) {
      case "codex-toml": {
        const disabled = [];
        if (opts.isolated === true && isolate.sharedSkillsDir !== void 0) {
          const sharedSkills = expandTilde(isolate.sharedSkillsDir, homedir);
          for (const entry2 of await listDirOrEmpty(sharedSkills)) {
            if (!desired.has(entry2.name)) disabled.push(path16.join(sharedSkills, entry2.name, "SKILL.md"));
          }
        }
        const codexModels = isolate.models !== void 0 && isolate.models.format === "codex-toml" && modelContent ? {
          providers: roleModels.providers,
          ...roleModels.default !== void 0 ? { default: roleModels.default } : {}
        } : void 0;
        if (Object.keys(servers).length > 0 || disabled.length > 0 || codexModels !== void 0) {
          await writeFileAtomic(
            file,
            renderCodexConfig(servers, {
              skillDisables: disabled,
              headerRefs: resolved.headerRefs,
              ...codexModels !== void 0 ? { models: codexModels } : {}
            })
          );
          mcpWritten = true;
        }
        break;
      }
      case "pi-json":
        if (Object.keys(servers).length > 0) {
          await writeFileAtomic(file, renderPiMcpJson(servers, resolved.headerRefs));
          mcpWritten = true;
        }
        break;
      case "claude-json": {
        const existing = await readTextIfExists(file);
        if (Object.keys(servers).length > 0) {
          await writeFileAtomic(file, renderClaudeConfig(existing, servers, resolved.headerRefs));
          mcpWritten = true;
        }
        break;
      }
      case "dsh-patch": {
        const dshModels = isolate.models !== void 0 && modelContent ? {
          providers: roleModels.providers,
          ...roleModels.default !== void 0 ? { default: roleModels.default } : {}
        } : void 0;
        await writeFileAtomic(file, renderDshPatch(servers, dshModels));
        mcpWritten = true;
        break;
      }
    }
  }
  let modelsReport = { file: null, providers: 0, default: null };
  if (isolate.models !== void 0 && modelContent) {
    resolveModelEnv(roleModels, opts.env ?? {}, opts.strictEnv !== false);
    const providerCount = Object.keys(roleModels.providers).length;
    const file = path16.join(root, isolate.models.file);
    switch (isolate.models.format) {
      case "pi-models-json": {
        if (providerCount > 0) await writeFileAtomic(file, renderPiModelsJson(roleModels));
        if (roleModels.default !== void 0) {
          const startup = findProviderModel(
            roleModels.providers,
            roleModels.default.provider,
            roleModels.default.model
          )?.model.thinkingLevel;
          const thinkingLevelsByModel = startup === void 0 ? void 0 : { [`${roleModels.default.provider}/${roleModels.default.model}`]: startup };
          const settingsFile = path16.join(root, isolate.models.settingsFile);
          await writeFileAtomic(
            settingsFile,
            renderPiSettingsJson(
              await readTextIfExists(settingsFile),
              void 0,
              roleModels.default,
              thinkingLevelsByModel
            )
          );
        }
        modelsReport = {
          file: providerCount > 0 ? file : null,
          providers: providerCount,
          default: roleModels.default !== void 0 ? `${roleModels.default.provider}/${roleModels.default.model}` : null
        };
        break;
      }
      case "dsh-patch":
      case "codex-toml": {
        modelsReport = {
          file: providerCount > 0 ? file : null,
          providers: providerCount,
          default: roleModels.default !== void 0 ? `${roleModels.default.provider}/${roleModels.default.model}` : null
        };
        break;
      }
      case "claude-settings-json": {
        const settingsPath = path16.join(root, isolate.models.file);
        await writeFileAtomic(
          settingsPath,
          renderClaudeSettingsJson(await readTextIfExists(settingsPath), roleModels.default?.model)
        );
        const provider = roleModels.default !== void 0 ? roleModels.providers[roleModels.default.provider] : void 0;
        const launchEnv = resolveClaudeLaunchEnv(provider, opts.env ?? {});
        modelsReport = {
          file: settingsPath,
          providers: providerCount,
          default: roleModels.default !== void 0 ? `${roleModels.default.provider}/${roleModels.default.model}` : null,
          ...Object.keys(launchEnv).length > 0 ? { env: launchEnv } : {}
        };
        break;
      }
    }
  }
  const metaFile = path16.join(root, "root.json");
  if (!await pathExists(metaFile)) {
    const now = ports.now?.() ?? /* @__PURE__ */ new Date();
    await writeFileAtomic(
      metaFile,
      `${JSON.stringify({ version: 1, role, agent: opts.agent, createdAt: now.toISOString() }, null, 2)}
`
    );
  }
  return {
    role,
    agent: opts.agent,
    root,
    supportLevel: isolate.supportLevel,
    skills: {
      added: skillResult.added,
      kept: skillResult.kept,
      removed: skillResult.removed,
      replaced: skillResult.replaced
    },
    desiredSkills: [...desired.keys()].sort(),
    skillSources: [...desired.keys()].sort().flatMap((name) => {
      const dir = desired.get(name);
      const sourceRole = sourceRoles.get(name);
      if (dir === void 0 || sourceRole === void 0) return [];
      return [{ name, role: sourceRole, dir }];
    }),
    instruction: { file: instructionFile, written: instructionText.length > 0 },
    auth,
    shared,
    mcp: { file: mcpWritten ? mcpFile : null, servers: Object.keys(servers).length },
    models: modelsReport,
    notes
  };
}
async function listRoots(home) {
  const rootBase = path16.join(home, "roots");
  let roleDirs;
  try {
    roleDirs = (await fs19.readdir(rootBase, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const out = [];
  for (const role of roleDirs) {
    const base = path16.join(rootBase, role);
    const agents = (await fs19.readdir(base, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const roleExists = await pathExists(roleDir(home, role));
    for (const agent of agents) {
      const dir = path16.join(base, agent);
      let meta = false;
      try {
        const raw = JSON.parse(await fs19.readFile(path16.join(dir, "root.json"), "utf8"));
        meta = typeof raw === "object" && raw !== null && raw.version === 1 && raw.role === role && raw.agent === agent;
      } catch {
        meta = false;
      }
      out.push({ role, agent, dir, meta, roleExists });
    }
  }
  return out.sort((a2, b) => a2.role === b.role ? a2.agent < b.agent ? -1 : 1 : a2.role < b.role ? -1 : 1);
}
async function cleanRoleRoots(home, role) {
  const base = path16.join(rootsDir(home), role);
  const summary = await listRoots(home).then((all) => all.filter((item) => item.role === role));
  if (summary.length === 0) return [];
  if (!await pathExists(base)) return [];
  await fs19.rm(base, { recursive: true, force: true });
  return summary.map((item) => item.dir);
}
async function rootSnapshot(home) {
  const roots = await listRoots(home);
  return { roots, orphans: roots.filter((root) => !root.roleExists) };
}

// packages/core/src/materialize.ts
import { createHash as createHash2, randomUUID as randomUUID6 } from "node:crypto";
import fs21 from "node:fs/promises";
import path18 from "node:path";

// packages/core/src/migrate.ts
import { createHash, randomUUID as randomUUID5 } from "node:crypto";
import fs20 from "node:fs/promises";
import path17 from "node:path";
var MIGRATE_STRATEGIES = ["first", "newest", "skip"];
async function readV3Lock(homedir) {
  const file = path17.join(homedir, ".agents", ".skill-lock.json");
  let text2;
  try {
    text2 = await fs20.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return { present: false, path: file, entries: {} };
    }
    throw error;
  }
  const fail = (reason) => ({
    present: true,
    path: file,
    entries: {},
    warning: `v3 lock at ${file} is unreadable (${reason}); skipping lock conversion \u2014 scan/absorb unaffected`
  });
  let parsed;
  try {
    parsed = JSON.parse(text2);
  } catch (error) {
    return fail(`not valid JSON: ${error.message}`);
  }
  if (!isRecord(parsed) || !isRecord(parsed.skills)) return fail("expected { skills: { \u2026 } }");
  const entries = {};
  for (const [name, value] of Object.entries(parsed.skills)) {
    if (isRecord(value)) entries[name] = value;
  }
  return { present: true, path: file, entries };
}
var HASH_IGNORED_NAMES = /* @__PURE__ */ new Set([".git", "node_modules"]);
async function collectFiles(dir, prefix, out) {
  const entries = await fs20.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (HASH_IGNORED_NAMES.has(entry.name)) continue;
    const rel = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      await collectFiles(path17.join(dir, entry.name), rel, out);
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
}
async function computeSkillFolderHash(dir) {
  const files = [];
  await collectFiles(dir, "", files);
  files.sort();
  const hash = createHash("sha256");
  for (const rel of files) {
    hash.update(rel, "utf8");
    hash.update(await fs20.readFile(path17.join(dir, ...rel.split("/"))));
  }
  return hash.digest("hex");
}
function normalizeSourceType(sourceType) {
  if (sourceType === "github" || sourceType === "gitlab" || sourceType === "azure") return "git";
  return sourceType && sourceType.length > 0 ? sourceType : "unknown";
}
function skillDirFromPath(skillPath) {
  if (typeof skillPath !== "string" || skillPath.length === 0) return void 0;
  const normalized = skillPath.replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  const dir = slash === -1 ? "" : normalized.slice(0, slash);
  return dir.length > 0 ? dir.replace(/\/+$/, "") : void 0;
}
var MAPPED_V3_FIELDS = /* @__PURE__ */ new Set([
  "source",
  "sourceType",
  "sourceUrl",
  "ref",
  "skillPath",
  "skillFolderHash",
  "installedAt"
]);
function convertV3Entry(entry, hash, fallbackInstalledAt) {
  const source = typeof entry.source === "string" && entry.source.length > 0 ? entry.source : "unknown";
  const converted = {
    source,
    sourceType: normalizeSourceType(entry.sourceType),
    hash,
    installedAt: typeof entry.installedAt === "string" && entry.installedAt.length > 0 ? entry.installedAt : fallbackInstalledAt
  };
  if (typeof entry.sourceUrl === "string" && entry.sourceUrl.length > 0) converted.sourceUrl = entry.sourceUrl;
  if (typeof entry.ref === "string" && entry.ref.length > 0) converted.resolvedRef = entry.ref;
  const skillDir = skillDirFromPath(entry.skillPath);
  if (skillDir !== void 0) converted.skillPath = skillDir;
  for (const [key, value] of Object.entries(entry)) {
    if (!MAPPED_V3_FIELDS.has(key)) converted[key] = value;
  }
  return converted;
}
var SKILL_NAME_PATTERN2 = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function compactTimestamp(at) {
  return at.toISOString().replace(/[-:.]/g, "");
}
function parseTime(value) {
  return typeof value === "string" ? Date.parse(value) : Number.NaN;
}
function buildScanSet(homedir, registry, withAgents) {
  const dirs = [{ agent: null, dir: path17.resolve(path17.join(homedir, ".agents", "skills")) }];
  if (withAgents) {
    for (const entry of registry) {
      const expanded = expandTilde(entry.skillsDir, homedir);
      if (path17.isAbsolute(expanded)) dirs.push({ agent: entry.id, dir: path17.resolve(expanded) });
    }
  }
  const seen = /* @__PURE__ */ new Set();
  return dirs.filter((scan) => {
    const key = caseFoldPath(scan.dir);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
async function hasSkillMd(dir) {
  try {
    const stat = await fs20.stat(path17.join(dir, "SKILL.md"));
    return stat.isFile();
  } catch {
    return false;
  }
}
async function mtimeMs(target) {
  try {
    return (await fs20.stat(target)).mtimeMs;
  } catch {
    return 0;
  }
}
async function candidateTime(origin, v3) {
  if (v3 !== void 0) {
    const stamped = parseTime(v3.updatedAt) || parseTime(v3.installedAt);
    if (!Number.isNaN(stamped) && stamped > 0) return stamped;
  }
  return mtimeMs(origin);
}
async function readDirEntries(dir) {
  try {
    return await fs20.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function pathExists3(target) {
  try {
    await fs20.lstat(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
var toSide = (candidate) => ({
  origin: candidate.origin,
  hash: candidate.hash,
  kind: candidate.kind,
  agent: candidate.agent,
  ...candidate.linkTarget !== void 0 ? { linkTarget: candidate.linkTarget } : {},
  ...candidate.at > 0 ? { at: candidate.at } : {}
});
async function runMigrate(ports, home, opts) {
  const role = opts.role ?? "default";
  const strategy = opts.strategy ?? "first";
  const apply = opts.apply ?? false;
  validateRoleName(role);
  const now = ports.now ? ports.now() : /* @__PURE__ */ new Date();
  const v3 = await readV3Lock(opts.homedir);
  const registry = await readRegistry(home);
  const scanSet = buildScanSet(opts.homedir, registry, opts.scanAgents === true || opts.absorbLinks === true);
  let existingLock = await readRoleLock(home, role);
  const candidates = [];
  const linksNoticed = [];
  const items = [];
  const itemsByName = /* @__PURE__ */ new Map();
  const notASkill = /* @__PURE__ */ new Map();
  const putItem = (item) => {
    items.push(item);
    itemsByName.set(item.skill, item);
  };
  for (const [scanPos, scan] of scanSet.entries()) {
    const anchored = scan.agent === null;
    for (const entry of await readDirEntries(scan.dir)) {
      if (!SKILL_NAME_PATTERN2.test(entry.name)) continue;
      const origin = path17.join(scan.dir, entry.name);
      const v3Entry = scan.agent === null ? v3.entries[entry.name] : void 0;
      if (entry.isSymbolicLink()) {
        if (opts.absorbLinks !== true) {
          linksNoticed.push({
            origin,
            note: `link found at ${origin}; rerun with --absorb-links to absorb it`
          });
          if (v3Entry !== void 0) {
            putItem({ skill: entry.name, disposition: "link-noticed", detail: "content is a link; rerun with --absorb-links" });
          }
          continue;
        }
        const resolution = await resolveLinkTarget(ports.link, origin);
        if (!resolution.exists) {
          putItem({
            skill: entry.name,
            disposition: "broken-link",
            detail: `broken link (${resolution.broken ?? "missing"}): ${origin} -> ${resolution.final}`
          });
          continue;
        }
        if (isInsidePath(home, resolution.final)) {
          putItem({
            skill: entry.name,
            disposition: "self-link",
            detail: `link resolves inside NEO_HOME (self-referential): ${origin} -> ${resolution.final}`
          });
          continue;
        }
        if (!await hasSkillMd(resolution.final)) {
          const list = notASkill.get(entry.name) ?? [];
          list.push(origin);
          notASkill.set(entry.name, list);
          continue;
        }
        candidates.push({
          name: entry.name,
          origin,
          kind: "link",
          agent: scan.agent,
          scanPos,
          hash: await computeSkillFolderHash(resolution.final),
          at: await mtimeMs(origin),
          ...v3Entry !== void 0 ? { v3: v3Entry } : {},
          linkTarget: resolution.final
        });
        continue;
      }
      if (!entry.isDirectory()) continue;
      const allowed = opts.scanAgents === true || anchored && v3Entry !== void 0;
      if (!allowed) continue;
      if (!await hasSkillMd(origin)) {
        const list = notASkill.get(entry.name) ?? [];
        list.push(origin);
        notASkill.set(entry.name, list);
        continue;
      }
      candidates.push({
        name: entry.name,
        origin,
        kind: "dir",
        agent: scan.agent,
        scanPos,
        hash: await computeSkillFolderHash(origin),
        at: await candidateTime(origin, v3Entry),
        ...v3Entry !== void 0 ? { v3: v3Entry } : {}
      });
    }
  }
  for (const [name, origins] of notASkill) {
    putItem({ skill: name, disposition: "not-a-skill", detail: `no SKILL.md: ${origins.join(", ")}` });
  }
  for (const [name] of Object.entries(v3.entries)) {
    if (candidates.some((candidate) => candidate.name === name) || itemsByName.has(name)) continue;
    if (existingLock?.skills[name] !== void 0) continue;
    putItem({
      skill: name,
      disposition: "missing",
      detail: `lock entry has no content directory under ${scanSet[0]?.dir ?? ""}`
    });
  }
  const byName = /* @__PURE__ */ new Map();
  for (const candidate of candidates) {
    byName.set(candidate.name, [...byName.get(candidate.name) ?? [], candidate]);
  }
  const plans = /* @__PURE__ */ new Map();
  for (const name of [...byName.keys()].sort()) {
    const discovered = byName.get(name) ?? [];
    const lockEntry = existingLock?.skills[name];
    const all = [];
    if (lockEntry !== void 0) {
      const dest = path17.join(roleSkillsDir(home, role), name);
      if (await pathExists3(dest)) {
        all.push({
          name,
          origin: dest,
          kind: "lock",
          agent: null,
          scanPos: -1,
          hash: await computeSkillFolderHash(dest),
          at: parseTime(lockEntry.installedAt) || 0,
          lockEntry
        });
      }
    }
    all.push(...discovered);
    const hashes = new Set(all.map((candidate) => candidate.hash));
    if (hashes.size <= 1) {
      const incumbent = all[0]?.kind === "lock" ? all[0] : void 0;
      if (incumbent !== void 0) {
        putItem({ skill: name, disposition: "skip-idempotent", winner: toSide(incumbent) });
        continue;
      }
      const [winner2, ...losers2] = all;
      plans.set(name, { winner: winner2, losers: losers2 });
      putItem({
        skill: name,
        disposition: "absorb",
        winner: toSide(winner2),
        losers: losers2.map(toSide)
      });
      continue;
    }
    if (strategy === "skip") {
      putItem({ skill: name, disposition: "conflict", conflictSides: all.map(toSide) });
      continue;
    }
    const ranked = strategy === "newest" ? [...all].sort((a2, b) => b.at - a2.at || a2.scanPos - b.scanPos) : all;
    const [winner, ...losers] = ranked;
    plans.set(name, { winner, losers });
    putItem({
      skill: name,
      disposition: "absorb",
      winner: toSide(winner),
      losers: losers.map(toSide)
    });
  }
  let quarantineRunDir = null;
  const plannedQuarantine = items.some((item) => (item.losers?.length ?? 0) > 0);
  const manifest = [];
  const slotCounter = /* @__PURE__ */ new Map();
  const nowIso = now.toISOString();
  if (apply) {
    for (const item of items) {
      if (item.disposition !== "absorb") continue;
      const plan = plans.get(item.skill);
      if (plan === void 0) continue;
      try {
        const entry = await applyOne({
          home,
          role,
          item,
          plan,
          lockFile: existingLock,
          nowIso,
          ensureRunDir: async () => {
            quarantineRunDir ??= await reserveRunDir(stateDir(home), now);
            return quarantineRunDir;
          },
          nextSlot: (skill) => {
            const used = slotCounter.get(skill) ?? 0;
            slotCounter.set(skill, used + 1);
            return used === 0 ? skill : `${skill}-${used + 1}`;
          },
          manifest,
          link: ports.link
        });
        if (entry !== null) existingLock = entry;
      } catch (error) {
        item.disposition = "error";
        item.error = error.message;
      }
    }
  }
  const quarantineDir = apply ? quarantineRunDir : plannedQuarantine ? path17.join(stateDir(home), "backups", "migrate", compactTimestamp(now)) : null;
  const notes = [];
  if (v3.present && items.some((item) => item.disposition === "absorb")) {
    notes.push(
      `upstream ${v3.path} still references absorbed skills (neo never rewrites it); clean up with 'npx skills rm' if desired`
    );
  }
  return {
    role,
    strategy,
    apply,
    home,
    scannedDirs: scanSet,
    v3Lock: {
      present: v3.present,
      path: v3.path,
      entries: Object.keys(v3.entries).length,
      ...v3.warning !== void 0 ? { warning: v3.warning } : {}
    },
    items,
    linksNoticed,
    quarantineDir,
    notes,
    ok: items.every((item) => item.disposition !== "error" && item.disposition !== "conflict")
  };
}
async function reserveRunDir(stateRoot, now) {
  const runDir = path17.join(stateRoot, "backups", "migrate", compactTimestamp(now));
  await fs20.mkdir(runDir, { recursive: true });
  return runDir;
}
async function persistManifest(runDir, manifest) {
  const file = path17.join(runDir, "manifest.json");
  const tmp = `${file}.${randomUUID5()}.tmp`;
  try {
    await fs20.writeFile(tmp, `${JSON.stringify(manifest, null, 2)}
`, "utf8");
    await fs20.rename(tmp, file);
  } finally {
    await fs20.rm(tmp, { force: true }).catch(() => void 0);
  }
}
async function relocateInto(from, to) {
  if (await pathExists3(to)) {
    throw new Error(`relocate target already exists (refusing to overwrite): ${to}`);
  }
  try {
    await fs20.rename(from, to);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    await fs20.cp(from, to, { recursive: true });
    await fs20.rm(from, { recursive: true, force: true });
  }
}
async function quarantineSide(ctx, side, reason) {
  const runDir = await ctx.ensureRunDir();
  const stored = path17.join(runDir, ctx.nextSlot(side.name));
  const row = {
    skill: side.name,
    kind: side.kind === "link" ? "link" : "dir",
    originalPath: side.origin,
    storedPath: stored,
    hash: side.hash,
    reason,
    time: ctx.nowIso,
    ...side.kind === "link" && side.linkTarget !== void 0 ? { target: side.linkTarget } : {}
  };
  if (side.kind === "link" && side.linkTarget !== void 0) {
    await ctx.link.linkDir(side.linkTarget, stored);
    await ctx.link.unlink(side.origin);
  } else {
    await relocateInto(side.origin, stored);
  }
  ctx.manifest.push(row);
  await persistManifest(runDir, ctx.manifest);
}
async function restoreSide(ctx, row) {
  if (row.kind === "link" && row.target !== void 0) {
    await ctx.link.linkDir(row.target, row.originalPath);
    await ctx.link.unlink(row.storedPath);
  } else {
    await relocateInto(row.storedPath, row.originalPath);
  }
}
function buildWinnerEntry(winner, nowIso) {
  if (winner.v3 !== void 0) return convertV3Entry(winner.v3, winner.hash, nowIso);
  if (winner.kind === "link" && winner.linkTarget !== void 0) {
    return { sourceType: "local", path: winner.linkTarget, hash: winner.hash, installedAt: nowIso };
  }
  return { source: "unknown", sourceType: "unknown", hash: winner.hash, installedAt: nowIso };
}
function loserReason(loser, winnerHash) {
  if (loser.kind === "lock") return "replaced-incumbent";
  return loser.hash === winnerHash ? "redundant-copy" : "conflict-loser";
}
async function applyOne(ctx) {
  const { plan } = ctx;
  const winner = plan.winner;
  const dest = path17.join(roleSkillsDir(ctx.home, ctx.role), winner.name);
  const undo = [];
  const rowsStart = ctx.manifest.length;
  const rollback = async (cause) => {
    const restoreFailures = [];
    for (const step of undo.reverse()) {
      try {
        await step();
      } catch (error) {
        restoreFailures.push(error.message);
      }
    }
    if (ctx.manifest.length > rowsStart) {
      const runDir = path17.dirname(ctx.manifest[rowsStart].storedPath);
      ctx.manifest.splice(rowsStart);
      try {
        await persistManifest(runDir, ctx.manifest);
      } catch {
      }
    }
    const detail = restoreFailures.length > 0 ? ` (rollback incomplete: ${restoreFailures.join("; ")})` : "";
    throw new Error(`${cause.message}${detail}`);
  };
  const quarantineWithUndo = async (side, reason) => {
    await quarantineSide(ctx, side, reason);
    const row = ctx.manifest[ctx.manifest.length - 1];
    undo.push(() => restoreSide(ctx, row));
  };
  try {
    await ensureRoleSkillsDir(ctx.home, ctx.role);
    const contentDir = winner.kind === "link" && winner.linkTarget !== void 0 ? winner.linkTarget : winner.origin;
    if (await computeSkillFolderHash(contentDir) !== winner.hash) {
      throw new Error("winner content changed since planning (hash mismatch); rerun migrate");
    }
    const occupant = plan.losers.find((loser) => loser.origin === dest);
    if (occupant === void 0 && winner.origin !== dest && await pathExists3(dest)) {
      await quarantineWithUndo(
        { name: winner.name, origin: dest, kind: "dir", hash: await computeSkillFolderHash(dest) },
        "replaced-untracked"
      );
    }
    if (occupant !== void 0) {
      await quarantineWithUndo(occupant, "replaced-incumbent");
    }
    if (winner.kind === "dir") {
      await relocateInto(winner.origin, dest);
      undo.push(() => relocateInto(dest, winner.origin));
    } else if (winner.kind === "link" && winner.linkTarget !== void 0) {
      if (await pathExists3(dest)) {
        throw new Error(`absorb target already exists (refusing to merge/overwrite): ${dest}`);
      }
      await fs20.cp(winner.linkTarget, dest, { recursive: true });
      undo.push(() => fs20.rm(dest, { recursive: true, force: true }));
      await quarantineWithUndo(winner, "absorbed-link");
    }
    for (const loser of plan.losers) {
      if (loser === occupant) continue;
      await quarantineWithUndo(loser, loserReason(loser, winner.hash));
    }
    if (winner.kind === "lock") return null;
    const lock = {
      ...ctx.lockFile ?? { version: 1 },
      version: 1,
      skills: { ...ctx.lockFile?.skills ?? {}, [winner.name]: buildWinnerEntry(winner, ctx.nowIso) }
    };
    await writeRoleLock(ctx.home, ctx.role, lock);
    return lock;
  } catch (cause) {
    await rollback(cause);
    throw cause;
  }
}

// packages/core/src/materialize.ts
async function readMarker(dir) {
  try {
    const raw = JSON.parse(await fs21.readFile(path18.join(dir, "root.json"), "utf8"));
    if (typeof raw === "object" && raw !== null && raw.version === 1 && typeof raw.role === "string" && typeof raw.agent === "string") {
      return raw;
    }
    return null;
  } catch {
    return null;
  }
}
function stagingFor(out) {
  return path18.join(
    path18.dirname(out),
    `.${path18.basename(out)}.materialize-${randomUUID6()}.tmp`
  );
}
async function removeMaterializedTree(link, dir) {
  for (const entry of await fs21.readdir(dir, { withFileTypes: true })) {
    const abs = path18.join(dir, entry.name);
    const info = await fs21.lstat(abs);
    if (info.isSymbolicLink()) {
      await link.unlink(abs);
    } else if (info.isDirectory()) {
      await removeMaterializedTree(link, abs);
      await fs21.rmdir(abs);
    } else {
      await fs21.unlink(abs);
    }
  }
}
async function assertOutUsable(out, role, agent) {
  let info;
  try {
    info = await fs21.lstat(out);
  } catch (error) {
    if (error.code === "ENOENT") return { kind: "new" };
    throw error;
  }
  if (!info.isDirectory()) {
    throw new NeoError("state", `--out is not a directory: ${out}`);
  }
  const contents = await fs21.readdir(out);
  if (contents.length === 0) return { kind: "empty" };
  const marker = await readMarker(out);
  if (marker === null) {
    throw new NeoError(
      "state",
      `--out already exists and is not a neo materialize product (missing root.json marker): ${out}`
    );
  }
  if (marker.role !== role || marker.agent !== agent) {
    throw new NeoError(
      "state",
      `--out is a neo materialize product for a different target (has role="${marker.role}" agent="${marker.agent}", requested role="${role}" agent="${agent}"); choose another --out or remove the directory`
    );
  }
  return { kind: "owned" };
}
function manifestHash(manifest) {
  const canonical = JSON.stringify({
    role: manifest.role,
    agent: manifest.agent,
    skills: manifest.skills,
    mcp: manifest.mcp,
    model: manifest.model,
    authExcluded: manifest.authExcluded
  });
  return createHash2("sha256").update(canonical, "utf8").digest("hex");
}
async function swapOutOwned(link, out, staging) {
  const backup = path18.join(
    path18.dirname(out),
    `.${path18.basename(out)}.old-${randomUUID6()}.tmp`
  );
  await fs21.rename(out, backup);
  try {
    await fs21.rename(staging, out);
  } catch (error) {
    await fs21.rename(backup, out).catch(() => void 0);
    throw new NeoError(
      "failure",
      `materialize: swap into ${out} failed (${error.message}); old root restored (or preserved at ${backup}), nothing half-written`
    );
  }
  await removeMaterializedTree(link, backup).catch(() => void 0);
  await fs21.rm(backup, { recursive: true, force: true }).catch(() => void 0);
}
async function materializeRoot(ports, home, homedir, opts) {
  validateRoleName(opts.role);
  const outState = await assertOutUsable(opts.out, opts.role, opts.agent);
  const staging = stagingFor(opts.out);
  let report;
  try {
    report = await convergeRoot(ports, home, homedir, {
      role: opts.role,
      agent: opts.agent,
      root: staging,
      ...opts.env !== void 0 ? { env: opts.env } : {},
      // T3:`--no-auth` 才排除 auth 副本(缺省保持票 01 同形;run 路径不经此处,校验照旧);
      // T2:env 存在性校验只属于 run(导出渲染本就落 `$VAR` 插值,明文不上盘);
      // T4:宿主自带模型时整段跳过模型渲染。
      skipAuth: opts.noAuth === true,
      strictEnv: false,
      ...opts.skipModels === true ? { skipModels: true } : {}
    });
  } catch (error) {
    await removeMaterializedTree(ports.link, staging).catch(() => void 0);
    await fs21.rm(staging, { recursive: true, force: true }).catch(() => void 0);
    throw error;
  }
  try {
    if (outState.kind === "owned") {
      await swapOutOwned(ports.link, opts.out, staging);
    } else {
      if (outState.kind === "empty") await fs21.rmdir(opts.out);
      await fs21.rename(staging, opts.out);
    }
  } catch (error) {
    if (error instanceof NeoError) throw error;
    await removeMaterializedTree(ports.link, staging).catch(() => void 0);
    await fs21.rm(staging, { recursive: true, force: true }).catch(() => void 0);
    throw new NeoError(
      "failure",
      `materialize: rename into ${opts.out} failed (${error.message}); staging cleaned, out unchanged`
    );
  }
  const skills = [];
  for (const skill of report.skillSources) {
    skills.push({
      name: skill.name,
      hash: await computeSkillFolderHash(skill.dir),
      source: skill.role
    });
  }
  const body = {
    role: opts.role,
    agent: opts.agent,
    skills,
    mcp: {
      file: report.mcp.file === null ? null : path18.relative(staging, report.mcp.file),
      servers: report.mcp.servers,
      // T1:导出根不自足的 env 绑定以引用形式进清单(与 convergeRoot 同一份 merge,不开第二份装配)。
      envRefs: collectMcpEnvRefs(
        mergeMcpServers(await readRoleMcp(home, "default"), await readRoleMcp(home, opts.role))
      )
    },
    model: {
      file: report.models.file === null ? null : path18.relative(staging, report.models.file),
      providers: report.models.providers,
      default: report.models.default,
      // T4:模型配置归属方;宿主自带(`--agent-models`)时为 host。
      owner: opts.skipModels === true ? "host" : "neo",
      ...report.models.file === null ? {
        reason: opts.skipModels === true ? "agent-models: host supplies its own model config" : report.models.providers === 0 && report.models.default === null ? "no-neo-model-declaration: config.yaml providers is empty" : "agent-has-no-model-file"
      } : {}
    },
    // T3:排除凭据副本时清单显式声明;默认 false(导出与启动根资源部分同形)。
    authExcluded: opts.noAuth === true
  };
  return {
    outDir: opts.out,
    manifest: { ok: true, outDir: opts.out, ...body, hash: manifestHash(body) }
  };
}

// packages/core/src/model-discovery.ts
var ENV_REF3 = /^env:([A-Za-z_][A-Za-z0-9_]*)$/;
function nodeFetchPort() {
  return async (url, init) => {
    const response = await fetch(url, {
      method: "GET",
      headers: init.headers,
      ...init.signal !== void 0 ? { signal: init.signal } : {}
    });
    return { status: response.status, json: () => response.json() };
  };
}
function resolveProviderAuth(provider, env) {
  const missingEnv = [];
  const headers = {};
  const resolve = (value) => {
    if (typeof value !== "string") return void 0;
    const match = ENV_REF3.exec(value);
    if (match === null) return value;
    const name = match[1];
    const resolved = env[name];
    if (resolved === void 0 || resolved.length === 0) {
      missingEnv.push(name);
      return void 0;
    }
    return resolved;
  };
  if (isRecord(provider.headers)) {
    for (const [key, value] of Object.entries(provider.headers)) {
      const resolved = resolve(value);
      if (resolved !== void 0) headers[key] = resolved;
    }
  }
  const apiKey = resolve(provider.apiKey);
  if (apiKey !== void 0) headers.Authorization = `Bearer ${apiKey}`;
  return { ...apiKey !== void 0 ? { apiKey } : {}, headers, missingEnv };
}
function modelListUrl(baseUrl) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new NeoError("state", `provider baseUrl must start with http:// or https:// (got ${JSON.stringify(baseUrl)})`);
  }
  return `${trimmed}/models`;
}
var CONTEXT_KEYS = ["context_length", "context_window", "max_context_length", "max_input_tokens", "max_model_len"];
var NESTED_OBJECT_KEYS = ["model_info", "top_provider", "architecture"];
function readNested(raw, keys) {
  const values = [];
  for (const key of keys) {
    const nested = raw[key];
    if (!isRecord(nested)) continue;
    for (const candidate of CONTEXT_KEYS) {
      if (nested[candidate] !== void 0) values.push(nested[candidate]);
    }
  }
  return values;
}
function probeContextWindow(raw) {
  const candidates = [...CONTEXT_KEYS.map((key) => raw[key]), ...readNested(raw, NESTED_OBJECT_KEYS)];
  for (const candidate of candidates) {
    if (candidate === void 0) continue;
    try {
      return parseTokenCount(candidate, "contextWindow");
    } catch {
    }
  }
  return void 0;
}
function probeInput(raw) {
  const modalities = raw.architecture;
  const arrays = [
    isRecord(modalities) ? modalities.input_modalities : void 0,
    raw.input_modalities,
    raw.modalities
  ];
  for (const value of arrays) {
    if (!Array.isArray(value)) continue;
    const images = value.some((item) => item === "image" || item === "vision");
    if (images) return ["text", "image"];
  }
  const flags = [
    raw.supports_vision,
    isRecord(raw.capabilities) ? raw.capabilities.vision : void 0,
    isRecord(raw.architecture) ? raw.architecture.supports_vision : void 0
  ];
  for (const value of flags) {
    if (value === true) return ["text", "image"];
  }
  return void 0;
}
function probeReasoning(raw) {
  const parameters = raw.supported_parameters;
  if (Array.isArray(parameters)) {
    const reasoning = parameters.some(
      (item) => item === "reasoning" || item === "reasoning_effort" || item === "include_reasoning" || item === "reasoning_content"
    );
    if (reasoning) return true;
  }
  const flags = [
    raw.supports_reasoning,
    isRecord(raw.capabilities) ? raw.capabilities.reasoning : void 0,
    raw.reasoning
  ];
  for (const value of flags) {
    if (value === true) return true;
  }
  return void 0;
}
function probeModelEntry(raw) {
  if (!isRecord(raw)) return void 0;
  if (typeof raw.id !== "string" || raw.id.length === 0) return void 0;
  const entry = { id: raw.id };
  if (typeof raw.name === "string" && raw.name.length > 0) entry.name = raw.name;
  const contextWindow = probeContextWindow(raw);
  if (contextWindow !== void 0) entry.contextWindow = contextWindow;
  const input = probeInput(raw);
  if (input !== void 0) entry.input = input;
  const reasoning = probeReasoning(raw);
  if (reasoning !== void 0) entry.reasoning = reasoning;
  return entry;
}
async function fetchModelList(port, request) {
  const url = modelListUrl(request.baseUrl);
  let response;
  try {
    response = await port(url, {
      headers: request.headers,
      signal: AbortSignal.timeout(2e4)
    });
  } catch (error) {
    throw new NeoError("failure", `cannot read ${url}: ${error.message}`);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new NeoError("failure", `${url} returned HTTP ${response.status}`);
  }
  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new NeoError("failure", `${url} did not return JSON: ${error.message}`);
  }
  if (!isRecord(body) || !Array.isArray(body.data)) {
    throw new NeoError("failure", `${url} does not look like an OpenAI model list (missing data[])`);
  }
  const models = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of body.data) {
    const entry = probeModelEntry(item);
    if (entry === void 0) continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    models.push(entry);
  }
  models.sort((a2, b) => a2.id.localeCompare(b.id));
  return { models, warnings: [] };
}
function mergeDiscoveredModels(existing, discovered, options = {}) {
  const existingById = new Map(existing.map((entry) => [entry.id, entry]));
  const discoveredIds = new Set(discovered.map((entry) => entry.id));
  const kept = [];
  const added = [];
  const vanished = [];
  for (const entry of existing) {
    if (discoveredIds.has(entry.id)) kept.push(entry.id);
    else vanished.push(entry.id);
  }
  const merged = [...existing];
  for (const entry of discovered) {
    if (existingById.has(entry.id)) continue;
    added.push(entry.id);
    merged.push(withModelDefaults(entry));
  }
  const models = options.prune === true ? merged.filter((entry) => !vanished.includes(entry.id)) : merged;
  return { models, added, kept, vanished };
}

// packages/core/src/model-config.ts
function cloneLoaded(loaded) {
  return {
    ...loaded,
    config: { ...loaded.config, providers: { ...loaded.config.providers } }
  };
}
function normalizeProvider(id, raw) {
  const table = parseProviderTable("config.yaml", { [id]: raw });
  return table[id];
}
function hasProvider(loaded, id) {
  return loaded.config.providers[id] !== void 0;
}
function upsertProvider(loaded, id, provider) {
  const next = cloneLoaded(loaded);
  next.config.providers[id] = normalizeProvider(id, provider);
  return next;
}
function removeProvider(loaded, id) {
  if (!hasProvider(loaded, id)) throw new NeoError("failure", `unknown provider "${id}"`);
  const next = cloneLoaded(loaded);
  delete next.config.providers[id];
  if (loaded.config.defaultModel?.provider === id) delete next.config.defaultModel;
  return next;
}
function setProviderModels(loaded, providerId, models) {
  const provider = loaded.config.providers[providerId];
  if (provider === void 0) throw new NeoError("failure", `unknown provider "${providerId}"`);
  return upsertProvider(loaded, providerId, { ...provider, models: [...models] });
}
function upsertModel(loaded, providerId, entry) {
  const provider = loaded.config.providers[providerId];
  if (provider === void 0) throw new NeoError("failure", `unknown provider "${providerId}"`);
  const models = providerModels(provider).filter((model) => model.id !== entry.id);
  models.push(entry);
  return upsertProvider(loaded, providerId, { ...provider, models });
}
function removeModel(loaded, providerId, modelId, options = {}) {
  const provider = loaded.config.providers[providerId];
  if (provider === void 0) throw new NeoError("failure", `unknown provider "${providerId}"`);
  const models = providerModels(provider);
  const target = models.find((model) => model.id === modelId);
  if (target === void 0) throw new NeoError("failure", `unknown model "${providerId}/${modelId}"`);
  const isDefault = loaded.config.defaultModel?.provider === providerId && loaded.config.defaultModel.model === modelId;
  if (isDefault && options.force !== true) {
    throw new NeoError(
      "failure",
      `"${providerId}/${modelId}" is config.defaultModel; pick another with "neo model use" or pass --force`
    );
  }
  const next = cloneLoaded(loaded);
  next.config.providers[providerId] = normalizeProvider(providerId, {
    ...provider,
    models: models.filter((model) => model.id !== modelId)
  });
  if (isDefault) delete next.config.defaultModel;
  return next;
}
function setDefaultModel(loaded, ref) {
  const next = cloneLoaded(loaded);
  if (ref === null) {
    delete next.config.defaultModel;
  } else {
    if (loaded.config.providers[ref.provider] === void 0) {
      throw new NeoError("failure", `unknown provider "${ref.provider}"`);
    }
    if (!providerModels(loaded.config.providers[ref.provider]).some((model) => model.id === ref.model)) {
      throw new NeoError("failure", `unknown model "${ref.provider}/${ref.model}"`);
    }
    next.config.defaultModel = ref;
  }
  return next;
}
function providerReferencedByDefault(loaded, providerId) {
  return loaded.config.defaultModel?.provider === providerId;
}
function modelReferencedByDefault(loaded, providerId, modelId) {
  return loaded.config.defaultModel?.provider === providerId && loaded.config.defaultModel.model === modelId;
}

// packages/core/src/launch.ts
import fs22 from "node:fs/promises";
import { constants as fsConstants2 } from "node:fs";
import net from "node:net";
import os2 from "node:os";
import path19 from "node:path";
var isWindows = process.platform === "win32";
var PI_SUBCOMMANDS = /* @__PURE__ */ new Set(["install", "remove", "uninstall", "update", "list", "config", "auth", "mcp"]);
async function isFile(target) {
  try {
    const stat = await fs22.stat(target);
    return stat.isFile();
  } catch (error) {
    const code = error.code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
}
async function isExecutableFile(target) {
  if (!await isFile(target)) return false;
  if (isWindows) return true;
  try {
    await fs22.access(target, fsConstants2.X_OK);
    return true;
  } catch {
    return false;
  }
}
async function findOnPath(command, env, cwd) {
  if (path19.isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    const target = path19.isAbsolute(command) ? command : path19.resolve(cwd, command);
    return await isExecutableFile(target) ? target : null;
  }
  const pathVar = env.PATH ?? env.Path ?? "";
  const delimiter = isWindows ? ";" : ":";
  const exts = isWindows ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter((ext) => ext.length > 0) : [""];
  for (const dir of pathVar.split(delimiter)) {
    if (dir.length === 0) continue;
    for (const ext of exts) {
      const candidate = path19.join(dir, `${command}${ext.toLowerCase()}`);
      if (await isExecutableFile(candidate)) return candidate;
      if (isWindows) {
        const upper = path19.join(dir, `${command}${ext.toUpperCase()}`);
        if (await isExecutableFile(upper)) return upper;
      }
    }
    const bare = path19.join(dir, command);
    if (await isExecutableFile(bare)) return bare;
  }
  return null;
}
async function resolveDsh(entry, homedir, env, cwd) {
  const layouts = [];
  if (isWindows) {
    const local = env.LOCALAPPDATA ?? path19.join(homedir, "AppData", "Local");
    for (const install of [
      path19.join(local, "Programs", "DeepSeek Harness"),
      path19.join(env.ProgramFiles ?? "C:\\Program Files", "DeepSeek Harness")
    ]) {
      layouts.push({ install, exe: "DeepSeek Harness.exe", resources: "resources" });
    }
  } else if (process.platform === "darwin") {
    layouts.push({
      install: "/Applications/DeepSeek Harness.app/Contents",
      exe: path19.join("MacOS", "DeepSeek Harness"),
      resources: "Resources"
    });
  }
  for (const layout of layouts) {
    const exe = path19.join(layout.install, layout.exe);
    const resources = path19.join(layout.install, layout.resources);
    const cli = path19.join(
      resources,
      "app.asar",
      "dsh",
      "node_modules",
      "@deepseek-ai",
      "dsh-desktop-host",
      "lib",
      "cli.js"
    );
    if (await isFile(exe) && await isFile(path19.join(resources, "app.asar"))) {
      return {
        command: exe,
        baseArgs: ["--expose-internals", cli],
        env: { ELECTRON_RUN_AS_NODE: "1" }
      };
    }
  }
  const shim = await findOnPath(entry.detect?.binary ?? "dsh", env, cwd);
  if (shim !== null) return { command: shim, baseArgs: [], env: {} };
  return null;
}
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}
async function resolveCommand(entry, homedir, env, cwd) {
  if (entry.id === "dsh") {
    const resolved = await resolveDsh(entry, homedir, env, cwd);
    if (resolved !== null) return resolved;
    throw new NeoError(
      "state",
      'DeepSeek Harness CLI not found; put "dsh" on PATH (Windows: <install>\\resources\\runtime\\cli\\bin\\dsh.cmd; macOS: /Applications/DeepSeek Harness.app)'
    );
  }
  const binary = entry.detect?.binary ?? entry.id;
  const found = await findOnPath(binary, env, cwd);
  if (found === null) {
    throw new NeoError(
      "state",
      `agent "${entry.id}" executable "${binary}" not found on PATH; install the agent or extend agents.yaml with detect.binary`
    );
  }
  return { command: found, baseArgs: [], env: {} };
}
async function planLaunch(ports, home, homedir, opts) {
  const registry = await readRegistry(home);
  const entry = registry.find((item) => item.id === opts.agent);
  if (entry === void 0) {
    throw new NeoError(
      "usage",
      `unknown agent "${opts.agent}" (neo run launches: ${launchableAgentIds(registry).join(", ")}; see all ids: neo list agents)`
    );
  }
  const isolate = entry.isolate;
  if (isolate === void 0 || !isolate.supports.includes("launch")) {
    throw new NeoError(
      "state",
      `agent "${entry.id}" cannot be launched with neo run (${launchBlockReason(entry)}); neo run launches: ${launchableAgentIds(registry).join(", ")}; for "${entry.id}" use: neo use <role> --project (repo-scoped) or neo use <role> --global (legacy mounts)`
    );
  }
  if (isolate.models !== void 0 && opts.useAgentModels !== true) {
    const { config } = await readConfig(home);
    if (Object.keys(config.providers).length === 0) {
      throw new NeoError(
        "state",
        `no model providers configured; "${entry.id}" would start with no model wired (neo renders its model config from config.yaml providers). add one: neo model provider add <id> --base-url <url> --api-key env:VAR (TTY: "neo model provider"), or use the agent's own model config/login: neo run ${entry.id} --agent-models`
      );
    }
  }
  const env = opts.env ?? {};
  const ephemeral = opts.ephemeral === true;
  const root = ephemeral ? await fs22.mkdtemp(path19.join(os2.tmpdir(), `neo-run-${opts.role}-${opts.agent}-`)) : void 0;
  const isolated = opts.isolated === true;
  const report = await convergeRoot(ports, home, homedir, {
    role: opts.role,
    agent: opts.agent,
    isolated,
    ...root !== void 0 ? { root } : {},
    env,
    // --agent-models:agent 自带模型/登录时,neo 连模型文件都不写(不只是跳过闸)。
    skipModels: opts.useAgentModels === true
  });
  const resolvedCommand = await resolveCommand(entry, homedir, env, opts.cwd);
  const args = [...resolvedCommand.baseArgs];
  const childEnv = { ...resolvedCommand.env, [isolate.homeEnv]: report.root };
  if (isolate.agentsEnv !== void 0) {
    const agentsHome = path19.join(report.root, "agents");
    await fs22.mkdir(agentsHome, { recursive: true });
    childEnv[isolate.agentsEnv] = agentsHome;
  }
  const servers = mergeMcpServers(await readRoleMcp(home, "default"), await readRoleMcp(home, opts.role));
  const mcpEnv = resolveMcpEnv(servers, env, entry.id);
  Object.assign(childEnv, mcpEnv.extraEnv);
  if (report.models.env !== void 0) Object.assign(childEnv, report.models.env);
  const notes = [];
  if (entry.id === "dsh") {
    const profile = opts.dshProfile ?? "web";
    args.push("--profile", profile);
    if (report.mcp.file !== null && await pathExists(report.mcp.file)) {
      args.push("--patch", report.mcp.file);
    }
    if (profile === "web") {
      args.push("--port", String(await freePort()));
    }
  } else if (isolated && isolate.isolatedFlags !== void 0) {
    const first = opts.args?.[0];
    const isPiSubcommand = entry.id === "pi" && first !== void 0 && PI_SUBCOMMANDS.has(first);
    if (!isPiSubcommand) {
      args.push(...isolate.isolatedFlags);
      if (entry.id === "pi") {
        for (const skill of report.desiredSkills) {
          args.push("--skill", path19.join(report.root, isolate.skillsDir, skill));
        }
      }
    }
  }
  args.push(...opts.args ?? []);
  if (opts.isolated === true) notes.push("isolated: shared user skills are disabled where the agent allows it");
  return {
    agent: opts.agent,
    role: opts.role,
    root: report.root,
    command: resolvedCommand.command,
    args,
    env: childEnv,
    cwd: opts.cwd,
    ephemeral,
    isolated,
    supportLevel: isolate.supportLevel === "full" ? "full" : "partial",
    notes,
    report
  };
}
async function disposeLaunch(plan) {
  if (!plan.ephemeral) return;
  await fs22.rm(plan.root, { recursive: true, force: true });
}

// packages/core/src/status.ts
import fs23 from "node:fs/promises";
import path20 from "node:path";
async function fileExists(target) {
  try {
    await fs23.stat(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
function parseNeoSource(home, target) {
  if (isInsidePath(rolesDir(home), target)) {
    const rel = path20.relative(rolesDir(home), target).split(path20.sep);
    if (rel.length >= 3 && rel[1] === "skills") {
      return { layer: "role", container: rel[0], name: rel[2] };
    }
    return null;
  }
  if (isInsidePath(libraryDir(home), target)) {
    const rel = path20.relative(libraryDir(home), target).split(path20.sep);
    if (rel.length >= 2 && rel[0] !== "" && rel[1] !== void 0) {
      return { layer: "domain", container: rel[0], name: rel[1] };
    }
  }
  return null;
}
function parseAgentsMdAccounting(previous) {
  if (!isRecord(previous) || previous.mounted !== true || typeof previous.file !== "string") {
    return void 0;
  }
  const entry = {
    mounted: true,
    file: previous.file
  };
  if (typeof previous.backup === "string") entry.backup = previous.backup;
  return entry;
}
async function readTextOrNull2(file) {
  try {
    return await fs23.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function auditAgentsMd(report, opts) {
  const { activeRole, homedir, target, entry, planned, planError, desiredBlocks, registry } = opts;
  const finding = (kind, file, detail) => {
    report.findings.push({
      check: "agentsmd-blocks",
      kind,
      path: file,
      detail,
      agent: target.agent,
      dir: target.skillsDir
    });
  };
  try {
    if (planError !== void 0) {
      finding("plan", planned?.file ?? path20.join(target.skillsDir, "(agents-md)"), planError);
      return "invalid opt-in";
    }
    if (planned !== void 0) {
      const content = await readTextOrNull2(planned.file);
      const hasBlocks = content !== null && containsNeoBlocks(content);
      const accounting2 = parseAgentsMdAccounting(entry?.agentsMd);
      if (accounting2 === void 0 && !hasBlocks) {
        return desiredBlocks.length > 0 ? "opt-in, not mounted" : "no blocks expected";
      }
      if (accounting2 !== void 0 && content === null) {
        finding(
          "file-missing",
          planned.file,
          `instruction file is missing but the ledger records an agentsMd mount; re-run "neo use --global"`
        );
        return "drift (file missing)";
      }
      if (desiredBlocks.length === 0 && hasBlocks) {
        finding(
          "blocks-residual",
          planned.file,
          `neo blocks remain but activeRole expects none${activeRole === null ? " (off)" : ""}; run "neo off --global" or re-run "neo use --global"`
        );
        return "drift (residual blocks)";
      }
      if (accounting2 === void 0) {
        finding(
          "residual-blocks",
          planned.file,
          `neo blocks present without ledger accounting; re-run "neo use --global" to re-account`
        );
        return "drift (unaccounted blocks)";
      }
      if (!hasBlocks) {
        finding(
          "blocks-missing",
          planned.file,
          `ledger records an agentsMd mount but the file has no neo blocks; re-run "neo use --global"`
        );
        return "drift (blocks missing)";
      }
      if (applyNeoBlocks(content ?? "", desiredBlocks).changed) {
        finding(
          "blocks-corrupt",
          planned.file,
          `neo blocks do not match the expected render for activeRole ${JSON.stringify(activeRole)} (stale role content, manual edits, or orphan markers); re-run "neo use --global"`
        );
        return "drift (blocks mismatch)";
      }
      return "mounted (verified)";
    }
    const accounting = parseAgentsMdAccounting(entry?.agentsMd);
    if (accounting !== void 0) {
      const file = path20.resolve(expandTilde(accounting.file, homedir));
      const content = await readTextOrNull2(file);
      if (content !== null && containsNeoBlocks(content)) {
        finding(
          "residual-blocks",
          file,
          `agentsMd opt-in removed in config but blocks remain (ledger accounting still present); re-enable the opt-in and run "neo off --global", or strip manually`
        );
        return "drift (residual blocks)";
      }
      finding(
        "stale-accounting",
        file,
        `agentsMd accounting in ledger but the target is not opted in and no blocks remain; stale ledger entry`
      );
      return "drift (stale accounting)";
    }
    const raw = registry.find((candidate) => candidate.id === target.agent)?.agentsMd;
    if (raw !== void 0) {
      const expanded = expandTilde(raw, homedir);
      if (path20.isAbsolute(expanded)) {
        const file = path20.resolve(expanded);
        const content = await readTextOrNull2(file);
        if (content !== null && containsNeoBlocks(content)) {
          finding(
            "residual-blocks",
            file,
            `neo blocks present without opt-in or ledger accounting; strip manually or opt in and re-run "neo use --global"`
          );
          return "drift (unaccounted blocks)";
        }
      }
    }
    return "not opted in";
  } catch (error) {
    report.errors.push(`cannot audit agentsMd for target "${target.agent}": ${error.message}`);
    return "unreadable";
  }
}
function notInitialized(home) {
  const message = `neo home not initialized (${configPath(home)} missing); bootstrap with: neo init`;
  return {
    initialized: false,
    home,
    activeRole: null,
    targets: [],
    findings: [],
    warnings: [],
    notes: [],
    legacyGlobalMounts: [],
    roles: [],
    adjudications: [],
    roots: [],
    launch: [],
    errors: [message],
    ok: false
  };
}
async function checkOverrideShadow(report, opts) {
  const accounting = parseAgentsMdAccounting(opts.entry?.agentsMd);
  if (accounting === void 0) return;
  if (opts.target.agent !== "codex") return;
  const file = opts.planned?.file ?? path20.resolve(expandTilde(accounting.file, opts.homedir));
  if (path20.basename(file) !== "AGENTS.md") return;
  const override = path20.join(path20.dirname(file), "AGENTS.override.md");
  let shadowed = false;
  try {
    await fs23.lstat(override);
    shadowed = true;
  } catch {
    shadowed = false;
  }
  if (!shadowed) return;
  report.warnings.push({
    check: "override-shadow",
    path: override,
    detail: `AGENTS.override.md exists (${override}); the mounted ${file} is not read by codex`
  });
}
async function auditRecordedSlots(report, ports, opts) {
  const { home, target, recorded, activeRole, assembly, registryDirs } = opts;
  const push = (check, kind, slot, detail) => {
    report.findings.push({
      check,
      kind,
      path: slot,
      detail,
      agent: target.agent,
      dir: target.skillsDir
    });
  };
  let verified = 0;
  for (const name of recorded) {
    const slot = path20.join(target.skillsDir, name);
    try {
      const info = await ports.link.lstat(slot);
      if (info === null) {
        push("missing-slot", "absent", slot, `recorded skill slot is absent; re-run "neo use --global" to re-mount`);
        continue;
      }
      if (!info.symlink) {
        push(
          "unmanaged-slot",
          info.directory ? "real-dir" : "real-file",
          slot,
          `recorded slot holds unmanaged ${info.directory ? "directory" : "file"}; neo never deletes it (migrate owns absorbing)`
        );
        continue;
      }
      const resolution = await resolveLinkTarget(ports.link, slot);
      const adjudication = assembly?.resolutions.get(name);
      const expectedPath = adjudication !== void 0 ? adjudication.winner.dir : activeRole === null ? null : (
        // 不在装配集内(旧账):期望沿用 default 来源(与既有语义一致)
        path20.join(roleSkillsDir(home, "default"), name)
      );
      if (expectedPath !== null && resolution.exists && samePath(resolution.final, expectedPath)) {
        verified++;
        continue;
      }
      if (!resolution.exists) {
        push(
          "repointed-slot",
          "dangling",
          slot,
          `dangling link -> ${resolution.final}${resolution.broken === "cycle" ? " (link cycle)" : " (target missing)"}; re-run "neo use --global" to re-mount`
        );
        continue;
      }
      const source = parseNeoSource(home, resolution.final);
      if (source === null || source.name !== name) {
        const kind = isInsidePath(home, resolution.final) ? "unexpected-target" : registryDirs.some((dir) => isInsidePath(dir, resolution.final)) ? "mirror" : "external";
        push(
          "repointed-slot",
          kind,
          slot,
          `repointed to ${kind === "mirror" ? "registry mirror" : kind === "external" ? "external target" : "unexpected path inside neo home"} -> ${resolution.final}; re-run "neo use --global" to re-mount`
        );
        continue;
      }
      if (activeRole === null) {
        push(
          "active-role",
          "off-but-mounted",
          slot,
          `config.activeRole is null (off) but recorded link remains -> ${resolution.final}; run "neo off --global"`
        );
      } else {
        const loser = adjudication?.losers.find((l) => samePath(l.dir, resolution.final));
        const why = adjudication !== void 0 && loser !== void 0 ? `; assembly: ${layerLabel(adjudication.winner)} wins over ${layerLabel(loser)} (role > domain > default)` : "";
        push(
          "active-role",
          "role-mismatch",
          slot,
          `activeRole "${activeRole}" expects ${expectedPath} but link points to ${resolution.final}${why}; re-run "neo use --global"`
        );
      }
    } catch (error) {
      report.errors.push(`cannot audit recorded slot ${slot}: ${error.message}`);
    }
  }
  return verified;
}
async function auditUnrecordedEntries(report, ports, opts) {
  const { home, target, registryDirs } = opts;
  const recordedSet = new Set(opts.recorded);
  const push = (kind, slot, detail) => {
    report.findings.push({
      check: "unmanaged-slot",
      kind,
      path: slot,
      detail,
      agent: target.agent,
      dir: target.skillsDir
    });
  };
  let entries;
  try {
    entries = (await fs23.readdir(target.skillsDir)).sort();
  } catch (error) {
    if (error.code !== "ENOENT") {
      report.errors.push(`cannot scan target dir ${target.skillsDir}: ${error.message}`);
      return;
    }
    entries = [];
  }
  for (const name of entries) {
    if (recordedSet.has(name)) continue;
    const slot = path20.join(target.skillsDir, name);
    try {
      const info = await ports.link.lstat(slot);
      if (info === null) continue;
      if (!info.symlink) {
        push(
          info.directory ? "real-dir" : "real-file",
          slot,
          `unmanaged ${info.directory ? "directory" : "file"} in mount point; neo never deletes it`
        );
        continue;
      }
      const resolution = await resolveLinkTarget(ports.link, slot);
      if (!resolution.exists) {
        push("dangling-entry", slot, `unrecorded dangling link -> ${resolution.final}; "neo off --global" sweeps it if it points into the neo home`);
        continue;
      }
      if (isInsidePath(home, resolution.final)) {
        push("orphan-link", slot, `unrecorded link into neo home -> ${resolution.final}; re-run "neo use --global" (or "neo off --global" to sweep) to re-account`);
        continue;
      }
      if (registryDirs.some((dir) => isInsidePath(dir, resolution.final))) continue;
      push("external-link", slot, `unmanaged external link -> ${resolution.final}; neo never deletes it`);
    } catch (error) {
      report.errors.push(`cannot audit entry ${slot}: ${error.message}`);
    }
  }
}
async function statusAudit(ports, home, opts) {
  if (!await fileExists(configPath(home))) return notInitialized(home);
  const { config } = await readConfig(home);
  const ledger = await readMounts(home);
  const registry = await readRegistry(home);
  const registryDirs = registrySkillDirs(registry, opts.homedir);
  const targets = await resolveTargets(home, opts.homedir, config.targets);
  const agentsMdPlan = planAgentsMdTargets(targets, registry, opts.homedir);
  const desiredBlocks = await desiredPromptBlocks(home, config.activeRole);
  const activeRole = config.activeRole;
  const assembly = activeRole === null ? null : await resolveRoleAssembly(home, activeRole);
  const desiredSkills2 = new Set(assembly?.resolutions.keys() ?? []);
  const report = {
    initialized: true,
    home,
    activeRole,
    targets: [],
    findings: [],
    warnings: [],
    notes: [],
    legacyGlobalMounts: [],
    roles: await Promise.all(
      (await listRoles(home, activeRole)).map(async (role) => ({
        ...role,
        domains: await readRoleDomains(home, role.name),
        dirty: false
      }))
    ),
    adjudications: (assembly ? [...assembly.resolutions.values()] : []).filter((resolution) => resolution.losers.length > 0).sort((a2, b) => a2.name < b.name ? -1 : a2.name > b.name ? 1 : 0).map((resolution) => ({
      skill: resolution.name,
      role: assembly?.role ?? "",
      winner: layerLabel(resolution.winner),
      losers: resolution.losers.map(layerLabel)
    })),
    roots: [],
    launch: [],
    errors: [],
    ok: true
  };
  for (const target of targets) {
    const recorded = [...ledger.targets[target.skillsDir]?.skills ?? []].sort();
    const recordedSet = new Set(recorded);
    const verified = await auditRecordedSlots(report, ports, {
      home,
      target,
      recorded,
      activeRole,
      assembly,
      registryDirs
    });
    await auditUnrecordedEntries(report, ports, { home, target, recorded, registryDirs });
    const agentsMdState = await auditAgentsMd(report, {
      activeRole,
      homedir: opts.homedir,
      target,
      entry: ledger.targets[target.skillsDir],
      planned: agentsMdPlan.byAgent.get(target.agent),
      planError: agentsMdPlan.errors.get(target.agent),
      desiredBlocks,
      registry
    });
    await checkOverrideShadow(report, {
      homedir: opts.homedir,
      target,
      entry: ledger.targets[target.skillsDir],
      planned: agentsMdPlan.byAgent.get(target.agent)
    });
    if (activeRole !== null) {
      const unrecorded = [...desiredSkills2].filter((name) => !recordedSet.has(name)).length;
      if (unrecorded > 0) {
        report.notes.push(`${target.agent}: ${unrecorded} desired skill(s) not recorded (run: neo use --global to converge)`);
      }
      if (ledger.targets[target.skillsDir] === void 0) {
        report.notes.push(`${target.agent}: no mounts recorded (run: neo use --global)`);
      }
      if (agentsMdState === "opt-in, not mounted") {
        report.notes.push(`${target.agent}: agentsMd opt-in not mounted yet (run: neo use --global)`);
      }
    }
    report.targets.push({
      agent: target.agent,
      dir: target.skillsDir,
      recorded: recorded.length,
      verified,
      agentsMd: agentsMdState
    });
  }
  const configured = new Set(targets.map((target) => caseFoldPath(target.skillsDir)));
  for (const [dir, entry] of Object.entries(ledger.targets)) {
    if (!configured.has(caseFoldPath(dir))) {
      report.notes.push(
        `ledger still records unconfigured target ${dir} (agent ${entry.agent}); links left as-is`
      );
    }
  }
  const legacyHome = path20.join(opts.homedir, "neo");
  if (!samePath(home, legacyHome) && await fileExists(path20.join(legacyHome, "config.yaml"))) {
    report.notes.push(
      "legacy neo home found at ~/neo; move it to ~/.neo (or set NEO_HOME=~/neo to keep using it)"
    );
  }
  for (const [dir, entry] of Object.entries(ledger.targets)) {
    const skills = [...entry.skills ?? []].length;
    const agentsMd = isRecord(entry.agentsMd) && entry.agentsMd.mounted === true;
    if (skills > 0 || agentsMd) {
      report.legacyGlobalMounts.push({ agent: entry.agent, dir, skills, agentsMd });
    }
  }
  const snapshot = await rootSnapshot(home);
  report.roots = snapshot.roots.map((root) => ({
    role: root.role,
    agent: root.agent,
    dir: root.dir,
    meta: root.meta,
    roleExists: root.roleExists
  }));
  report.launch = registry.map((entry) => {
    const isolate = entry.isolate;
    const level = isolate === void 0 ? "none" : isolate.supportLevel === "full" ? "full" : "partial";
    return {
      agent: entry.id,
      level,
      supports: [...isolate?.supports ?? []],
      models: isolate?.models?.format ?? "none"
    };
  });
  const dirtyRoles = /* @__PURE__ */ new Set();
  for (const role of await listLockedRoles(home)) {
    try {
      const lock = await readRoleLock(home, role);
      if (isLockDirty(lock)) {
        dirtyRoles.add(role);
        report.findings.push({
          check: "lock-dirty",
          kind: "assembly-changed",
          path: roleLockPath(home, role),
          detail: `role "${role}" assembly changed since last convergence; run "neo update" or "neo use --global" to re-converge and clear`,
          agent: "",
          dir: ""
        });
      }
    } catch (error) {
      report.errors.push(`cannot audit lock for role "${role}": ${error.message}`);
    }
  }
  for (const view of report.roles) {
    if (dirtyRoles.has(view.name)) view.dirty = true;
  }
  report.ok = report.initialized && report.findings.length === 0 && report.errors.length === 0;
  return report;
}

// packages/core/src/update.ts
import fs24 from "node:fs/promises";
import os3 from "node:os";
import path21 from "node:path";
function groupLockSources(skills) {
  const groups = /* @__PURE__ */ new Map();
  const orphans = [];
  for (const name of Object.keys(skills).sort()) {
    const entry = skills[name];
    if (entry === void 0) continue;
    const source = entry.sourceType === "local" ? entry.path : entry.source;
    if (typeof source !== "string" || source.length === 0) {
      orphans.push(name);
      continue;
    }
    const key = `${entry.sourceType}\0${source}`;
    const group = groups.get(key) ?? {
      source,
      sourceType: entry.sourceType,
      names: [],
      entries: /* @__PURE__ */ new Map()
    };
    group.names.push(name);
    group.entries.set(name, entry);
    groups.set(key, group);
  }
  const sorted = [...groups.values()].sort((a2, b) => a2.source < b.source ? -1 : a2.source > b.source ? 1 : 0);
  return { groups: sorted, orphans };
}
async function classifyItems(home, role, group, stagedNames, upstreamLock) {
  const stagedSet = new Set(stagedNames);
  const items = [];
  for (const name of group.names) {
    const entry = group.entries.get(name);
    if (entry === void 0) continue;
    if (!stagedSet.has(name)) {
      items.push({ name, state: "gone-from-source", oldHash: entry.hash });
      continue;
    }
    const meta = upstreamLock?.skills?.[name];
    const newHash = typeof meta?.computedHash === "string" ? meta.computedHash : "";
    const dirExists = await pathExists(path21.join(roleSkillsDir(home, role), name));
    if (newHash !== "" && newHash === entry.hash && dirExists) {
      items.push({ name, state: "unchanged", oldHash: entry.hash, newHash });
    } else {
      items.push({
        name,
        state: "update",
        oldHash: entry.hash,
        ...newHash !== "" ? { newHash } : {},
        ...dirExists ? {} : { note: "local directory missing (repair)" }
      });
    }
  }
  for (const name of stagedNames) {
    if (group.entries.has(name)) continue;
    const meta = upstreamLock?.skills?.[name];
    const newHash = typeof meta?.computedHash === "string" ? meta.computedHash : "";
    items.push({ name, state: "would-install", ...newHash !== "" ? { newHash } : {} });
  }
  return items.sort((a2, b) => a2.name < b.name ? -1 : a2.name > b.name ? 1 : 0);
}
async function updateRoles(ports, home, opts) {
  const now = ports.now ? ports.now() : /* @__PURE__ */ new Date();
  let roles;
  if (opts.roles !== void 0) {
    for (const role of opts.roles) validateRoleName(role);
    roles = [...new Set(opts.roles)];
  } else {
    roles = await listLockedRoles(home);
  }
  const outcomes = [];
  for (const role of roles) {
    outcomes.push(await updateOneRole(ports, home, role, opts, now));
  }
  return {
    dryRun: opts.dryRun,
    roles: outcomes,
    ok: outcomes.every(
      (outcome) => outcome.error === void 0 && (opts.dryRun || outcome.failed.length === 0 && outcome.sources.every((source) => source.error === void 0))
    )
  };
}
async function updateOneRole(ports, home, role, opts, now) {
  let lock;
  try {
    lock = await readRoleLock(home, role);
  } catch (error) {
    return {
      role,
      skipped: false,
      sources: [],
      applied: [],
      failed: [],
      warnings: [],
      error: error.message
    };
  }
  if (lock === null) {
    return {
      role,
      skipped: true,
      note: "no lock (skipped)",
      sources: [],
      applied: [],
      failed: [],
      warnings: []
    };
  }
  const outcome = {
    role,
    skipped: false,
    sources: [],
    applied: [],
    failed: [],
    warnings: []
  };
  const { groups, orphans } = groupLockSources(lock.skills);
  for (const name of orphans) {
    outcome.failed.push({ name, error: "lock entry has no source/path to re-pull; remove and re-add the skill" });
  }
  const skills = { ...lock.skills };
  if (!opts.dryRun) {
    await ensureRoleSkillsDir(home, role);
  }
  for (const group of groups) {
    const sourceOutcome = {
      source: group.source,
      sourceType: group.sourceType,
      items: []
    };
    if (group.sourceType === "local" && !await pathExists(group.source)) {
      sourceOutcome.error = `local source path missing: ${group.source} (local content kept)`;
      outcome.sources.push(sourceOutcome);
      continue;
    }
    const staging = await fs24.mkdtemp(path21.join(ports.stagingRoot ?? os3.tmpdir(), "neo-staging-"));
    try {
      const listed = await ports.exec.run(
        buildUpstreamAddArgs({ skillsRef: opts.skillsRef, source: group.source, listOnly: true }),
        { cwd: staging }
      );
      let gone = [];
      let installable = group.names;
      if (listed.code === 0) {
        const currentNames = new Set(
          listed.stdout.split(/\r?\n/).map((line) => line.replace(/^[-*\s]+/, "").split(":")[0]?.trim() ?? "").filter((name) => name.length > 0 && isSafeSkillName(name))
        );
        gone = group.names.filter((name) => !currentNames.has(name));
        installable = group.names.filter((name) => currentNames.has(name));
      }
      if (installable.length === 0 && gone.length > 0) {
        for (const name of gone) {
          sourceOutcome.items.push({
            name,
            state: "gone-from-source",
            ...group.entries.get(name)?.hash !== void 0 ? { oldHash: group.entries.get(name)?.hash } : {}
          });
        }
        if (!opts.dryRun) {
          for (const item of sourceOutcome.items) {
            if (item.state === "gone-from-source") {
              outcome.warnings.push(
                `gone-from-source ${item.name}: kept locally (remove explicitly with: neo remove ${item.name} --role ${role})`
              );
            }
          }
        }
        outcome.sources.push(sourceOutcome);
        continue;
      }
      const result = await ports.exec.run(
        buildUpstreamAddArgs({
          skillsRef: opts.skillsRef,
          source: group.source,
          skills: { kind: "list", names: installable }
        }),
        { cwd: staging }
      );
      if (result.code !== 0) {
        sourceOutcome.error = summarizeUpstreamFailure(result);
        outcome.sources.push(sourceOutcome);
        continue;
      }
      const stagedNames = await enumerateStagedSkills(staging);
      const goneSet = new Set(gone);
      const stagedGone = stagedNames.filter((name) => goneSet.has(name));
      if (stagedGone.length > 0) {
        sourceOutcome.error = `upstream staged skills reported as gone: ${stagedGone.join(", ")}`;
        outcome.sources.push(sourceOutcome);
        continue;
      }
      const upstreamLock = await readUpstreamLock(staging);
      sourceOutcome.items.push(
        ...await classifyItems(home, role, group, stagedNames, upstreamLock)
      );
      if (!opts.dryRun) {
        for (const item of sourceOutcome.items) {
          if (item.state === "unchanged") continue;
          if (item.state === "gone-from-source") {
            outcome.warnings.push(
              `gone-from-source ${item.name}: kept locally (remove explicitly with: neo remove ${item.name} --role ${role})`
            );
            continue;
          }
          const meta = upstreamLock?.skills?.[item.name];
          const hash = typeof meta?.computedHash === "string" ? meta.computedHash : "";
          try {
            if (!isSafeSkillName(item.name) || hash === "") {
              throw new Error(
                hash === "" ? "upstream lock has no computedHash for this skill (refusing to install untracked content)" : `unsafe staged skill name ${JSON.stringify(item.name)}`
              );
            }
            const replaced = await relocateSkill(
              path21.join(staging, ".agents", "skills", item.name),
              home,
              role,
              item.name,
              now
            );
            skills[item.name] = buildLockEntry(group.source, meta, hash, now);
            outcome.applied.push({
              name: item.name,
              kind: item.state === "update" ? "updated" : "installed",
              ...item.state === "update" ? { oldHash: item.oldHash } : {},
              newHash: hash,
              replaced
            });
          } catch (error) {
            outcome.failed.push({ name: item.name, error: error.message });
          }
        }
      }
    } finally {
      await fs24.rm(staging, { recursive: true, force: true }).catch(() => void 0);
    }
    outcome.sources.push(sourceOutcome);
  }
  if (!opts.dryRun) {
    const cleanPass = outcome.sources.every((source) => source.error === void 0) && outcome.failed.length === 0;
    const clearDirty = isLockDirty(lock) && cleanPass;
    if (outcome.applied.length > 0 || clearDirty) {
      const merged = { ...lock, version: 1, skills };
      if (clearDirty) delete merged.dirty;
      await writeRoleLock(home, role, merged);
    }
  }
  return outcome;
}

// packages/core/src/remove.ts
import fs25 from "node:fs/promises";
import path22 from "node:path";
function normalizeSkills(skills) {
  return [...new Set(skills)];
}
async function planRemove(home, opts) {
  validateRoleName(opts.role);
  for (const name of normalizeSkills(opts.skills)) validateSkillName(name);
  const lock = await readRoleLock(home, opts.role);
  const items = [];
  const missing = [];
  for (const name of normalizeSkills(opts.skills)) {
    const hasDir = await pathExists(path22.join(roleSkillsDir(home, opts.role), name));
    const hasLockEntry = lock?.skills[name] !== void 0;
    if (hasDir || hasLockEntry) items.push({ name, hasDir, hasLockEntry });
    else missing.push(name);
  }
  return { role: opts.role, items, missing };
}
async function removeSkills(ports, home, opts) {
  validateRoleName(opts.role);
  for (const name of normalizeSkills(opts.skills)) validateSkillName(name);
  const lock = await readRoleLock(home, opts.role);
  const report = { role: opts.role, removed: [], failed: [], ok: true };
  const skills = { ...lock?.skills ?? {} };
  let lockDirty = false;
  for (const name of normalizeSkills(opts.skills)) {
    const dir = path22.join(roleSkillsDir(home, opts.role), name);
    const hasDir = await pathExists(dir);
    const hasLockEntry = Object.prototype.hasOwnProperty.call(skills, name);
    if (!hasDir && !hasLockEntry) {
      report.failed.push({ name, error: `not found in role "${opts.role}"` });
      continue;
    }
    try {
      if (hasDir) await fs25.rm(dir, { recursive: true, force: true });
    } catch (error) {
      report.failed.push({ name, error: error.message });
      continue;
    }
    if (hasLockEntry) {
      delete skills[name];
      lockDirty = true;
    }
    report.removed.push({ name, deletedDir: hasDir, deletedLockEntry: hasLockEntry });
  }
  if (lock !== null && lockDirty) {
    const merged = { ...lock, version: 1, skills };
    await writeRoleLock(home, opts.role, merged);
  }
  if (report.removed.some((item) => item.deletedDir)) {
    try {
      const { config } = await readConfig(home);
      const mounted = opts.role === "default" ? config.activeRole !== null : config.activeRole === opts.role;
      if (mounted) {
        report.converge = await useRole(ports, home, { homedir: opts.homedir });
      }
    } catch (error) {
      report.convergeError = error.message;
    }
  }
  report.ok = report.failed.length === 0 && report.convergeError === void 0 && (report.converge === void 0 || report.converge.ok);
  return report;
}

// packages/core/src/project.ts
var import_yaml7 = __toESM(require_dist(), 1);
import { randomUUID as randomUUID7 } from "node:crypto";
import fs26 from "node:fs/promises";
import path23 from "node:path";
function projectManifestPath(root) {
  return path23.join(root, ".agents", "neo.yaml");
}
function invalid6(message) {
  return new NeoError("state", `.agents/neo.yaml: ${message}`);
}
async function readProjectManifest(root) {
  const file = projectManifestPath(root);
  let text2;
  try {
    text2 = await fs26.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  let raw;
  try {
    raw = (0, import_yaml7.parse)(text2);
  } catch (error) {
    throw invalid6(`not valid YAML (${error.message})`);
  }
  if (raw === null || raw === void 0) throw invalid6("file is empty; expected a mapping with version: 1");
  if (!isRecord(raw)) throw invalid6("expected a top-level mapping");
  const version = raw.version;
  if (version === void 0) throw invalid6('missing required field "version"');
  if (version !== 1) {
    throw invalid6(
      `unsupported version ${String(version)} (supported major version: 1; refusing to read or write)`
    );
  }
  if (raw.materialize === void 0) throw invalid6('missing required field "materialize"');
  if (raw.materialize !== "copy" && raw.materialize !== "link") {
    throw invalid6(`"materialize" must be copy|link, got: ${JSON.stringify(String(raw.materialize))}`);
  }
  if (raw.agentsMd === void 0) throw invalid6('missing required field "agentsMd"');
  if (typeof raw.agentsMd !== "boolean") throw invalid6('"agentsMd" must be a boolean');
  if (raw.roles === void 0) throw invalid6('missing required field "roles"');
  if (!Array.isArray(raw.roles)) throw invalid6('"roles" must be a list');
  const roles = [];
  for (const [index, entry] of raw.roles.entries()) {
    if (typeof entry !== "string" || !ROLE_NAME_PATTERN.test(entry)) {
      throw invalid6(`roles[${index}] is not a valid role name: ${JSON.stringify(entry)}`);
    }
    if (roles.includes(entry)) throw invalid6(`duplicate role "${entry}" in roles list`);
    roles.push(entry);
  }
  if (raw.skills === void 0) throw invalid6('missing required field "skills"');
  if (!isRecord(raw.skills)) throw invalid6('"skills" must be a mapping of skill name to source hash');
  const skills = {};
  for (const [name, value] of Object.entries(raw.skills)) {
    if (!isSafeSkillName(name)) {
      throw invalid6(`skills key is not a valid skill name: ${JSON.stringify(name)}`);
    }
    if (typeof value !== "string" || value.length === 0) {
      throw invalid6(`skills.${name} must be a non-empty string (source hash)`);
    }
    skills[name] = value;
  }
  return {
    version: 1,
    manifest: { version: 1, materialize: raw.materialize, agentsMd: raw.agentsMd, roles, skills },
    raw,
    file,
    root
  };
}
async function writeProjectManifest(root, loaded) {
  if (loaded.raw.version !== void 0 && loaded.raw.version !== 1) {
    throw invalid6(
      `unsupported version ${String(loaded.raw.version)} (supported major version: 1; refusing to read or write)`
    );
  }
  const { manifest } = loaded;
  for (const role of manifest.roles) {
    if (!ROLE_NAME_PATTERN.test(role)) {
      throw invalid6(`refusing to write manifest with invalid role name: ${JSON.stringify(role)}`);
    }
  }
  for (const name of Object.keys(manifest.skills)) {
    if (!isSafeSkillName(name)) {
      throw invalid6(`refusing to write manifest with invalid skill name: ${JSON.stringify(name)}`);
    }
  }
  const sortedSkills = {};
  for (const name of Object.keys(manifest.skills).sort()) {
    sortedSkills[name] = manifest.skills[name];
  }
  const out = {
    ...loaded.raw,
    version: 1,
    materialize: manifest.materialize,
    agentsMd: manifest.agentsMd,
    roles: [...manifest.roles],
    skills: sortedSkills
  };
  const file = projectManifestPath(root);
  await fs26.mkdir(path23.dirname(file), { recursive: true });
  const tmp = path23.join(path23.dirname(file), `.${path23.basename(file)}.${randomUUID7()}.tmp`);
  try {
    await fs26.writeFile(tmp, (0, import_yaml7.stringify)(out), "utf8");
    await fs26.rename(tmp, file);
  } finally {
    await fs26.rm(tmp, { recursive: true, force: true }).catch(() => void 0);
  }
}
async function discoverProjectManifest(cwd) {
  let current = path23.resolve(cwd);
  for (; ; ) {
    const file = projectManifestPath(current);
    try {
      const stat = await fs26.stat(file);
      if (stat.isFile()) return { root: current, file };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = path23.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
var MATERIALIZE_DIRS = [".agents/skills", ".claude/skills"];
async function assertRolesInstalled(home, roles) {
  for (const role of roles) {
    validateRoleName(role);
    if (!await existsDir(roleDir(home, role))) {
      throw new NeoError(
        "state",
        `role "${role}" is not installed in this NEO_HOME; add it first (run: neo add <source> -s <skill> --role ${role}); project binding never absorbs skills from the project`
      );
    }
  }
}
async function desiredSet(home, roles) {
  const desired = /* @__PURE__ */ new Map();
  for (const role of roles) {
    validateRoleName(role);
    if (!await existsDir(roleDir(home, role))) {
      throw new NeoError(
        "state",
        `role "${role}" is not installed in this NEO_HOME; add it first (run: neo add <source> -s <skill> --role ${role}); project binding never absorbs skills from the project`
      );
    }
    const names = await skillDirNames(roleSkillsDir(home, role));
    for (const name of names) {
      const sourcePath = path23.join(roleSkillsDir(home, role), name);
      desired.set(name, { name, sourceRole: role, sourcePath, sourceHash: await computeSkillFolderHash(sourcePath) });
    }
  }
  return desired;
}
async function skillDirNames(dir) {
  try {
    const entries = await fs26.readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function measureSlot(ports, slot) {
  let info;
  try {
    info = await ports.link.lstat(slot);
  } catch (error) {
    if (error.code === "ENOENT") return { exists: false };
    return { exists: true, problem: `lstat failed: ${error.message}` };
  }
  if (info === null) return { exists: false };
  if (!info.symlink) {
    try {
      return { exists: true, hash: await computeSkillFolderHash(slot) };
    } catch (error) {
      return { exists: true, problem: `unreadable content: ${error.message}` };
    }
  }
  try {
    const resolution = await resolveLinkTarget(ports.link, slot);
    if (!resolution.exists) {
      return { exists: true, linkTarget: resolution.final, problem: `broken link -> ${resolution.final}` };
    }
    return { exists: true, linkTarget: resolution.final, hash: await computeSkillFolderHash(resolution.final) };
  } catch (error) {
    return { exists: true, problem: `link resolution failed: ${error.message}` };
  }
}
function slotAligned(mode, fact, sourcePath, sourceHash) {
  if (fact.hash !== sourceHash) return false;
  if (mode === "link") return fact.linkTarget !== void 0 && samePath(fact.linkTarget, sourcePath);
  return fact.linkTarget === void 0;
}
async function projectShadowingWarnings(home, homedir, skills) {
  if (skills.length === 0) return [];
  const registry = await readRegistry(home);
  const warnings = [];
  for (const agentId of ["claude-code", "zcode"]) {
    const entry = registry.find((candidate) => candidate.id === agentId);
    if (entry === void 0) continue;
    const expanded = expandTilde(entry.skillsDir, homedir);
    if (!path23.isAbsolute(expanded)) continue;
    const dir = path23.resolve(expanded);
    for (const skill of skills) {
      if (!await pathExists(path23.join(dir, skill))) continue;
      warnings.push(
        `skill "${skill}" in this project is shadowed by the global layer under ${agentId} (user level wins over workspace); fix: unmount it globally or remove it from the project binding`
      );
    }
  }
  return warnings;
}
var PROJECT_EXTRA_MD = [
  "CLAUDE.md",
  ".claude/CLAUDE.md",
  "GEMINI.md",
  ".github/copilot-instructions.md"
];
async function desiredProjectBlocks(home, roles) {
  const blocks = [];
  for (const role of roles) {
    let content = null;
    try {
      content = await fs26.readFile(roleAgentsMd(home, role), "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (content !== null && !isEmptyPrompt(content, role)) {
      assertNoNeoMarkerLines(role, content);
      blocks.push({ role, content });
    }
  }
  return blocks;
}
var writeTextAtomic = (file, content) => writeFileAtomic(file, content, { defaultMode: 420 });
async function convergeProjectAgentsMd(root, home, roles, opts) {
  const desired = opts.agentsMd ? await desiredProjectBlocks(home, roles) : [];
  const targets = [path23.join(root, "AGENTS.md")];
  for (const rel of PROJECT_EXTRA_MD) {
    const file = path23.join(root, ...rel.split("/"));
    if (await pathExists(file)) targets.push(file);
  }
  const actions = [];
  let failed = false;
  for (const file of targets) {
    try {
      let content = null;
      try {
        content = await fs26.readFile(file, "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const hasBlocks = content !== null && containsProjectBlocks(content);
      if (desired.length === 0) {
        if (!hasBlocks) continue;
        if (opts.apply) await writeTextAtomic(file, stripProjectBlocks(content ?? "").content);
        actions.push({ kind: "stripped", file });
        continue;
      }
      if (content === null) {
        if (opts.apply) await writeTextAtomic(file, applyProjectBlocks("", desired).content);
        actions.push({ kind: "mounted", file });
        continue;
      }
      const next = applyProjectBlocks(content, desired);
      if (!next.changed) continue;
      if (opts.apply) await writeTextAtomic(file, next.content);
      actions.push({ kind: hasBlocks ? "updated" : "mounted", file });
    } catch (error) {
      actions.push({ kind: "error", file, note: error.message });
      failed = true;
    }
  }
  return { actions, failed };
}
async function syncProject(ports, home, homedir, opts) {
  const apply = opts.apply ?? false;
  const force = opts.force ?? false;
  const loaded = opts.loaded ?? await readProjectManifest(opts.root);
  if (loaded === null) {
    throw new NeoError(
      "state",
      `no project manifest found at ${projectManifestPath(opts.root)}; bind a role first (run: neo use <role> --project)`
    );
  }
  const { manifest } = loaded;
  const desired = await desiredSet(home, manifest.roles);
  const mode = manifest.materialize;
  const items = [];
  const snapshotRemovals = /* @__PURE__ */ new Set();
  const snapshotUpdates = /* @__PURE__ */ new Map();
  const warnings = [];
  const notes = [];
  const errors = [];
  const slots = (skill) => MATERIALIZE_DIRS.map((base) => {
    const dir = path23.join(loaded.root, ...base.split("/"));
    const slot = path23.join(dir, skill);
    if (path23.dirname(slot) !== dir || !isInsidePath(dir, slot)) {
      throw new NeoError(
        "state",
        `refusing to touch ${JSON.stringify(skill)} outside materialize dir ${dir}`
      );
    }
    return slot;
  });
  const putUpdate = (skill, hash) => {
    if (manifest.skills[skill] !== hash) snapshotUpdates.set(skill, hash);
  };
  for (const skill of [.../* @__PURE__ */ new Set([...desired.keys(), ...Object.keys(manifest.skills)])].sort()) {
    const want = desired.get(skill);
    const snapshotHash = manifest.skills[skill];
    const slotsNow = slots(skill);
    const facts = await Promise.all(slotsNow.map((slot) => measureSlot(ports, slot)));
    if (want === void 0) {
      if (facts.every((fact) => !fact.exists)) {
        snapshotRemovals.add(skill);
        items.push({ skill, status: "manifest-changed", action: "remove", detail: "already absent on disk" });
        continue;
      }
      const accounted = (fact) => fact.linkTarget !== void 0 ? isInsidePath(home, fact.linkTarget) : fact.hash === snapshotHash;
      const unaccounted = facts.find((fact) => fact.exists && !accounted(fact));
      if (unaccounted === void 0 || force) {
        const forced = unaccounted !== void 0;
        if (apply) {
          const failure = await removeSlots(ports, slotsNow, facts);
          if (failure !== void 0) {
            errors.push({ skill, error: failure });
            items.push({ skill, status: "manifest-changed", action: "skip", detail: failure });
            continue;
          }
        }
        snapshotRemovals.add(skill);
        items.push({
          skill,
          status: "manifest-changed",
          action: "remove",
          ...forced ? { detail: "--force removed hand-edited copies" } : {}
        });
        continue;
      }
      items.push({
        skill,
        status: "manifest-changed",
        action: "skip",
        detail: "hand-edited project copy left in place (snapshot entry kept); rerun with --force to delete it"
      });
      warnings.push(
        `skill "${skill}" left the binding but its project copy was hand-edited; not deleted \u2014 inspect it, rerun with --force, or remove it manually`
      );
      continue;
    }
    if (snapshotHash === void 0) {
      const foreign = facts.find((fact) => fact.exists && fact.hash !== want.sourceHash);
      if (foreign !== void 0) {
        items.push({
          skill,
          status: "manifest-changed",
          action: "skip",
          detail: "unmanaged content already occupies the materialization path; never forced \u2014 move it away, or bind it manually"
        });
        continue;
      }
      if (apply) {
        const failure = await convergeSlots(ports, mode, slotsNow, facts, want.sourcePath, want.sourceHash);
        if (failure !== void 0) {
          errors.push({ skill, error: failure });
          items.push({ skill, status: "manifest-changed", action: "skip", detail: failure });
          continue;
        }
        putUpdate(skill, want.sourceHash);
      }
      items.push({ skill, status: "manifest-changed", action: "materialize", sourceRole: want.sourceRole });
      continue;
    }
    const broken = facts.find((fact) => !fact.exists || fact.problem !== void 0);
    const hashes = new Set(facts.filter((fact) => fact.hash !== void 0).map((fact) => fact.hash));
    const inFrame = (hash) => hash === snapshotHash || hash === want.sourceHash;
    const handEdited = broken !== void 0 || [...hashes].some((hash) => !inFrame(hash));
    if (!handEdited) {
      const aligned = facts.every((fact) => slotAligned(mode, fact, want.sourcePath, want.sourceHash));
      if (aligned && snapshotHash === want.sourceHash) {
        items.push({ skill, status: "match", action: "none", sourceRole: want.sourceRole });
        continue;
      }
      if (apply) {
        const failure = await convergeSlots(ports, mode, slotsNow, facts, want.sourcePath, want.sourceHash);
        if (failure !== void 0) {
          errors.push({ skill, error: failure });
          items.push({ skill, status: "source-updated", action: "skip", detail: failure, sourceRole: want.sourceRole });
          continue;
        }
        putUpdate(skill, want.sourceHash);
      }
      items.push({ skill, status: "source-updated", action: "overwrite", sourceRole: want.sourceRole });
      continue;
    }
    if (force) {
      if (apply) {
        const failure = await convergeSlots(ports, mode, slotsNow, facts, want.sourcePath, want.sourceHash);
        if (failure !== void 0) {
          errors.push({ skill, error: failure });
          items.push({ skill, status: "project-edited", action: "skip", detail: failure, sourceRole: want.sourceRole });
          continue;
        }
        putUpdate(skill, want.sourceHash);
      }
      items.push({ skill, status: "project-edited", action: "overwrite", sourceRole: want.sourceRole });
      continue;
    }
    const why = broken !== void 0 ? broken.exists ? broken.problem ?? "unreadable" : "project copy is missing" : "hand-edited (content matches neither snapshot nor source)";
    items.push({
      skill,
      status: "project-edited",
      action: "skip",
      sourceRole: want.sourceRole,
      detail: `${why}; left untouched \u2014 rerun with --force to overwrite`
    });
  }
  let manifestWritten = false;
  if (apply && (snapshotRemovals.size > 0 || snapshotUpdates.size > 0)) {
    for (const skill of snapshotRemovals) delete manifest.skills[skill];
    for (const [skill, hash] of snapshotUpdates) manifest.skills[skill] = hash;
    await writeProjectManifest(loaded.root, loaded);
    manifestWritten = true;
  }
  if (apply && mode === "link") {
    const hint = await gitignoreHint(loaded.root);
    if (hint !== null) notes.push(hint);
  }
  const agentsMdResult = await convergeProjectAgentsMd(loaded.root, home, manifest.roles, {
    agentsMd: manifest.agentsMd,
    apply
  });
  warnings.unshift(...await projectShadowingWarnings(home, homedir, [...desired.keys()]));
  return {
    root: loaded.root,
    file: loaded.file,
    roles: [...manifest.roles],
    materialize: mode,
    apply,
    items,
    agentsMd: agentsMdResult.actions,
    warnings,
    notes,
    manifestWritten,
    ok: errors.length === 0 && items.every((item) => item.action !== "skip") && !agentsMdResult.failed
  };
}
async function useProject(ports, home, homedir, opts) {
  validateRoleName(opts.role);
  const requestedMode = opts.link === true ? "link" : void 0;
  const found = await discoverProjectManifest(opts.cwd);
  let loaded;
  let created = false;
  let alreadyBound = false;
  let modeChanged = null;
  if (found === null) {
    await assertRolesInstalled(home, [opts.role]);
    loaded = {
      version: 1,
      manifest: {
        version: 1,
        materialize: requestedMode ?? "copy",
        agentsMd: false,
        roles: [opts.role],
        skills: {}
      },
      raw: {},
      file: projectManifestPath(opts.cwd),
      root: path23.resolve(opts.cwd)
    };
    await writeProjectManifest(loaded.root, loaded);
    created = true;
  } else {
    const existing = await readProjectManifest(found.root);
    if (existing === null) {
      throw new NeoError("state", `project manifest disappeared: ${found.file}`);
    }
    loaded = existing;
    await assertRolesInstalled(home, [.../* @__PURE__ */ new Set([...loaded.manifest.roles, opts.role])]);
    alreadyBound = loaded.manifest.roles.includes(opts.role);
    if (!alreadyBound) loaded.manifest.roles = [...loaded.manifest.roles, opts.role];
    if (requestedMode !== void 0 && requestedMode !== loaded.manifest.materialize) {
      modeChanged = requestedMode;
      loaded.manifest.materialize = requestedMode;
    }
    if (!alreadyBound || modeChanged !== null) await writeProjectManifest(loaded.root, loaded);
  }
  const sync = await syncProject(ports, home, homedir, { root: loaded.root, apply: true, loaded });
  return {
    root: loaded.root,
    file: loaded.file,
    role: opts.role,
    created,
    alreadyBound,
    modeChanged,
    sync
  };
}
async function offProject(ports, home, homedir, opts) {
  const found = await discoverProjectManifest(opts.cwd);
  if (found === null) {
    throw new NeoError(
      "state",
      "no project manifest found (cwd up-search): project not bound (run: neo use <role> --project to bind)"
    );
  }
  const existing = await readProjectManifest(found.root);
  if (existing === null) {
    throw new NeoError("state", `project manifest disappeared: ${found.file}`);
  }
  const loaded = existing;
  let removedRoles;
  let cleared = false;
  const requested = opts.roles ?? [];
  if (requested.length === 0) {
    removedRoles = [...loaded.manifest.roles];
    cleared = true;
  } else {
    for (const role of requested) {
      validateRoleName(role);
      if (!loaded.manifest.roles.includes(role)) {
        throw new NeoError(
          "state",
          `role "${role}" is not bound in this project (bound: ${loaded.manifest.roles.join(", ") || "(none)"})`
        );
      }
    }
    removedRoles = [...requested];
    const remaining = loaded.manifest.roles.filter((role) => !requested.includes(role));
    if (remaining.length === 0) cleared = true;
    loaded.manifest.roles = remaining;
  }
  if (cleared) loaded.manifest.roles = [];
  else await writeProjectManifest(loaded.root, loaded);
  const sync = await syncProject(ports, home, homedir, { root: loaded.root, apply: true, loaded });
  if (cleared && sync.ok) {
    await fs26.rm(loaded.file, { force: true });
  } else if (cleared) {
    sync.warnings.push(
      `project manifest kept at ${loaded.file}: sync did not fully succeed; fix the skipped items and rerun "neo off --project"`
    );
  }
  return { root: loaded.root, file: loaded.file, removedRoles, cleared, sync };
}
async function removeSlots(ports, slots, facts) {
  for (const [index, slot] of slots.entries()) {
    if (!facts[index]?.exists) continue;
    try {
      const info = await ports.link.lstat(slot);
      if (info !== null && info.symlink) await ports.link.unlink(slot);
      else await fs26.rm(slot, { recursive: true, force: true });
    } catch (error) {
      return `remove failed at ${slot}: ${error.message}`;
    }
  }
  return void 0;
}
async function convergeSlots(ports, mode, slots, facts, sourcePath, sourceHash) {
  const sourceInfo = await ports.link.lstat(sourcePath);
  if (sourceInfo === null) return `skill source missing: ${sourcePath}`;
  for (const [index, slot] of slots.entries()) {
    const fact = facts[index];
    if (slotAligned(mode, fact, sourcePath, sourceHash)) continue;
    try {
      await fs26.mkdir(path23.dirname(slot), { recursive: true });
      if (fact.exists) {
        const info = await ports.link.lstat(slot);
        if (info !== null && info.symlink) await ports.link.unlink(slot);
        else await fs26.rm(slot, { recursive: true, force: true });
      }
      if (await pathExists(slot)) {
        return `materialize target still occupied (refusing to overwrite): ${slot}`;
      }
      if (mode === "link") await ports.link.linkDir(sourcePath, slot);
      else await fs26.cp(sourcePath, slot, { recursive: true });
    } catch (error) {
      return `materialize failed at ${slot}: ${error.message}`;
    }
  }
  return void 0;
}
async function gitignoreHint(root) {
  const wanted = [".agents/skills", ".claude/skills"];
  let text2 = null;
  try {
    text2 = await fs26.readFile(path23.join(root, ".gitignore"), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (text2 === null) return `link products are not committed; add lines to .gitignore: ${wanted.join(", ")}`;
  const lines = new Set(
    text2.split(/\r?\n/).map((line) => line.trim().replaceAll("\\", "/")).filter((line) => line.length > 0)
  );
  const missing = wanted.filter((entry) => !lines.has(entry) && !lines.has(`${entry}/`));
  if (missing.length === 0) return null;
  return `link products are not committed; add lines to .gitignore: ${missing.join(", ")}`;
}

// packages/core/src/detect.ts
import path24 from "node:path";
async function detectAgent(entry, homedir, port) {
  const signals = [];
  if (entry.detect !== void 0) {
    if (entry.detect.dir !== void 0) {
      const expanded = expandTilde(entry.detect.dir, homedir);
      if (path24.isAbsolute(expanded) && await port.exists(expanded)) signals.push("dir");
    }
    if (entry.detect.binary !== void 0 && await port.binaryOnPath(entry.detect.binary)) {
      signals.push("binary");
    }
  }
  return { id: entry.id, signals };
}
async function detectAgents(entries, homedir, port) {
  return Promise.all(entries.map((entry) => detectAgent(entry, homedir, port)));
}

// packages/core/src/detect-node.ts
import fs27 from "node:fs/promises";
import { constants as fsConstants3 } from "node:fs";
import path25 from "node:path";
function nodeDetectPort() {
  return {
    async exists(absPath) {
      try {
        await fs27.access(absPath);
        return true;
      } catch {
        return false;
      }
    },
    async binaryOnPath(binary) {
      const dirs = (process.env.PATH ?? "").split(path25.delimiter).filter((dir) => dir.length > 0);
      const candidates = process.platform === "win32" ? [binary, `${binary}.exe`, `${binary}.cmd`, `${binary}.bat`] : [binary];
      for (const dir of dirs) {
        for (const candidate of candidates) {
          try {
            await fs27.access(path25.join(dir, candidate), fsConstants3.F_OK);
            if (process.platform !== "win32") {
              await fs27.access(path25.join(dir, candidate), fsConstants3.X_OK);
            }
            return true;
          } catch {
          }
        }
      }
      return false;
    }
  };
}

// packages/cli/src/cli-util.ts
function parseArgs(argv, spec) {
  const parsed = { positionals: [], flags: /* @__PURE__ */ new Map(), bools: /* @__PURE__ */ new Set() };
  let endOfOptions = false;
  for (let i2 = 0; i2 < argv.length; i2++) {
    const arg = argv[i2];
    if (!endOfOptions && arg === "--") {
      endOfOptions = true;
      continue;
    }
    if (endOfOptions || !arg.startsWith("-")) {
      parsed.positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const head = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? void 0 : arg.slice(eq + 1);
    const name = head.startsWith("--") ? head.slice(2) : head.slice(1);
    if (name.length === 0) throw new NeoError("usage", `unknown option: ${arg}`);
    const valued = spec.valued.has(name);
    const bool = spec.boolean.has(name);
    if (!valued && !bool) throw new NeoError("usage", `unknown option: ${arg}`);
    if (valued) {
      let value = inline;
      if (value === void 0) {
        const next = argv[i2 + 1];
        if (next === void 0 || next.startsWith("-") && next !== "*") {
          throw new NeoError("usage", `option ${head} expects a value`);
        }
        value = next;
        i2++;
      }
      const list = parsed.flags.get(name) ?? [];
      list.push(value);
      parsed.flags.set(name, list);
    } else {
      if (inline !== void 0) throw new NeoError("usage", `option ${head} does not take a value`);
      parsed.bools.add(name);
    }
  }
  return parsed;
}
function boolFlags(...names) {
  return /* @__PURE__ */ new Set([...names, "yes"]);
}
function resolveHome(deps) {
  return resolveNeoHome({ env: deps.env, homedir: deps.homedir });
}
function expectSinglePositional(parsed, usage) {
  if (parsed.positionals.length === 0) throw new NeoError("usage", `usage: neo ${usage}`);
  if (parsed.positionals.length > 1) throw new NeoError("usage", `${usage}: too many arguments`);
  return parsed.positionals[0];
}
function lastFlag(parsed, name) {
  const list = parsed.flags.get(name);
  return list && list.length > 0 ? list[list.length - 1] : void 0;
}

// packages/cli/src/model-command.ts
var ENV_REF4 = /^env:[A-Za-z_][A-Za-z0-9_]*$/;
var PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
var DEFAULT_API = "openai-completions";
async function cmdModel(args, io, deps) {
  const first = args[0];
  const sub = first === void 0 || first.startsWith("-") ? void 0 : first;
  if (sub === void 0 || sub === "list" || sub === "ls") {
    return cmdOverview(sub === void 0 ? args : args.slice(1), io, deps);
  }
  switch (sub) {
    case "provider":
      return cmdProvider(args.slice(1), io, deps);
    case "refresh":
      return cmdRefresh(args.slice(1), io, deps);
    case "add":
      return cmdModelAdd(args.slice(1), io, deps);
    case "rm":
    case "remove":
      return cmdModelRemove(args.slice(1), io, deps);
    case "edit":
      return cmdModelEdit(args.slice(1), io, deps);
    case "use":
      return cmdModelUse(args.slice(1), io, deps);
    default:
      throw new NeoError(
        "usage",
        `model: unknown subcommand "${sub}" (expected list|provider|refresh|add|rm|edit|use)`
      );
  }
}
function formatTokens(value) {
  if (value === void 0) return "-";
  if (value % 1e6 === 0) return `${value / 1e6}M`;
  if (value % 1e3 === 0) return `${value / 1e3}K`;
  return String(value);
}
function describeModel(entry) {
  const model = withModelDefaults(entry);
  const inputs = (model.input ?? []).join(",") || "-";
  const levels = (model.thinkingLevels ?? []).join(",") || "-";
  return `ctx=${formatTokens(model.contextWindow)} out=${formatTokens(model.maxTokens)} in=${inputs} reasoning=${model.reasoning === true ? "yes" : "no"} levels=${levels} startup=${model.thinkingLevel ?? "-"}`;
}
function warnAgentSpecificLevels(io, levels) {
  if (levels !== void 0 && levels.includes("ultra")) {
    io.stderr('note: thinking level "ultra" is only rendered by Codex; Pi and DSH ignore it\n');
  }
}
function refString(ref) {
  return ref === void 0 ? null : `${ref.provider}/${ref.model}`;
}
function providerSummary(id, provider) {
  const baseUrl = typeof provider.baseUrl === "string" ? provider.baseUrl : "-";
  const api = typeof provider.api === "string" ? provider.api : "-";
  const apiKey = typeof provider.apiKey === "string" ? provider.apiKey : "-";
  const headers = provider.headers === void 0 ? 0 : Object.keys(provider.headers).length;
  return `${id}  ${baseUrl}  api=${api}  key=${apiKey}  headers=${headers}`;
}
async function cmdOverview(args, io, deps) {
  const parsed = parseArgs(args, { valued: /* @__PURE__ */ new Set(), boolean: boolFlags("json") });
  if (parsed.positionals.length > 0) {
    throw new NeoError("usage", `model: unexpected argument "${parsed.positionals[0] ?? ""}"`);
  }
  const home = resolveHome(deps);
  const { config } = await readConfig(home);
  if (parsed.bools.has("json")) {
    io.stdout(
      `${JSON.stringify(
        {
          home,
          defaultModel: refString(config.defaultModel),
          providers: Object.entries(config.providers).map(([id, provider]) => ({
            id,
            ...provider
          }))
        },
        null,
        2
      )}
`
    );
    return 0;
  }
  const entries = Object.entries(config.providers);
  io.stdout(`neo model: ${home}
`);
  if (entries.length === 0) {
    io.stdout('no providers yet; add one with "neo model provider add <id> --base-url <url>"\n');
  } else {
    io.stdout(`providers (${entries.length}):
`);
    for (const [id, provider] of entries) {
      io.stdout(`  ${providerSummary(id, provider)}
`);
      for (const entry of providerModels(provider)) {
        io.stdout(`    ${entry.id}  ${describeModel(entry)}
`);
      }
    }
  }
  const current = refString(config.defaultModel);
  io.stdout(`default: ${current ?? '(none \u2014 set with "neo model use <provider>/<model>")'}
`);
  return 0;
}
async function cmdProvider(args, io, deps) {
  const first = args[0];
  const sub = first === void 0 || first.startsWith("-") ? void 0 : first;
  if (sub === "list" || sub === "ls") {
    return cmdProviderList(args.slice(1), io, deps);
  }
  if (sub === void 0) {
    return cmdProviderHub(args, io, deps);
  }
  switch (sub) {
    case "add":
      return cmdProviderAdd(args.slice(1), io, deps);
    case "rm":
    case "remove":
      return cmdProviderRemove(args.slice(1), io, deps);
    case "edit":
      return cmdProviderEdit(args.slice(1), io, deps);
    default:
      throw new NeoError("usage", `model provider: unknown subcommand "${sub}" (expected list|add|rm|edit)`);
  }
}
var PROVIDER_MENU = [
  { value: "add", label: "Add a provider", hint: "base URL + key, then read /v1/models" },
  { value: "edit", label: "Edit a provider", hint: "base URL, api, key reference" },
  { value: "refresh", label: "Refresh model lists", hint: "merge from /v1/models (additive)" },
  { value: "remove", label: "Remove a provider", hint: "refuses while referenced" },
  { value: "done", label: "Done" }
];
var PROVIDER_HUB_VALUED = /* @__PURE__ */ new Set(["base-url", "api", "api-key", "header", "rm-header"]);
function rebuildFlags(parsed) {
  const out = [];
  for (const [name, values] of parsed.flags) {
    for (const value of values) out.push(`--${name}`, value);
  }
  for (const name of parsed.bools) out.push(`--${name}`);
  return out;
}
async function cmdProviderHub(args, io, deps) {
  const parsed = parseArgs(args, {
    valued: PROVIDER_HUB_VALUED,
    boolean: boolFlags("force", "no-fetch", "dry-run", "prune", "json")
  });
  if (parsed.positionals.length > 0) {
    throw new NeoError("usage", `model provider: unexpected argument "${parsed.positionals[0] ?? ""}"`);
  }
  if (parsed.bools.has("json")) return cmdProviderList(args, io, deps);
  if (!interactiveTty(deps)) {
    throw new NeoError("usage", "model provider: pass a subcommand (list|add|edit|rm) when not interactive");
  }
  const prompts = deps.prompts ?? defaultPromptPort;
  const flags = rebuildFlags(parsed);
  await cmdOverview([], io, deps);
  for (; ; ) {
    const action = await prompts.select("Provider actions", PROVIDER_MENU);
    if (action === "done") return 0;
    const code = action === "add" ? await cmdProviderAdd([...flags], io, deps) : action === "edit" ? await cmdProviderEdit([...flags], io, deps) : action === "refresh" ? await cmdRefresh([...flags], io, deps) : await cmdProviderRemove([...flags], io, deps);
    if (code !== 0) return code;
    await printProviderSummary(io, deps);
  }
}
async function printProviderSummary(io, deps) {
  const { config } = await readConfig(resolveHome(deps));
  const entries = Object.entries(config.providers);
  io.stdout(`
providers (${entries.length}): ${entries.map(([id]) => id).join(", ") || "(none)"}
`);
}
async function cmdProviderList(args, io, deps) {
  const parsed = parseArgs(args, { valued: /* @__PURE__ */ new Set(), boolean: boolFlags("json") });
  if (parsed.positionals.length > 0) throw new NeoError("usage", "model provider list: takes no arguments");
  const home = resolveHome(deps);
  const { config } = await readConfig(home);
  const entries = Object.entries(config.providers);
  if (parsed.bools.has("json")) {
    io.stdout(
      `${JSON.stringify({ providers: entries.map(([id, provider]) => ({ id, ...provider })) }, null, 2)}
`
    );
    return 0;
  }
  if (entries.length === 0) {
    io.stdout('no providers; add one with "neo model provider add <id> --base-url <url>"\n');
    return 0;
  }
  for (const [id, provider] of entries) io.stdout(`${providerSummary(id, provider)}
`);
  return 0;
}
function requireProviderId(raw) {
  if (!PROVIDER_ID.test(raw)) {
    throw new NeoError(
      "usage",
      `invalid provider id ${JSON.stringify(raw)} (expected ${PROVIDER_ID.source})`
    );
  }
  return raw;
}
function singlePositional(parsed, usage) {
  if (parsed.positionals.length > 1) throw new NeoError("usage", `${usage}: too many arguments`);
  return parsed.positionals[0];
}
function providerOptions(entries) {
  return entries.map(([id, provider]) => {
    const baseUrl = typeof provider.baseUrl === "string" ? provider.baseUrl : "-";
    return { value: id, label: id, hint: `${baseUrl} \xB7 ${providerModels(provider).length} model(s)` };
  });
}
function modelOptions(providers) {
  const options = [];
  for (const [id, provider] of Object.entries(providers)) {
    for (const entry of providerModels(provider)) {
      options.push({
        value: `${id}/${entry.id}`,
        label: `${id}/${entry.id}`,
        hint: describeModel(entry)
      });
    }
  }
  return options;
}
async function resolveProviderId(parsed, deps, prompts, usage, entries, message) {
  const raw = singlePositional(parsed, usage);
  if (raw !== void 0) return requireProviderId(raw);
  if (!interactiveTty(deps)) throw new NeoError("usage", `usage: neo ${usage}`);
  if (entries.length === 0) {
    throw new NeoError(
      "failure",
      'no providers yet; add one with "neo model provider add <id> --base-url <url>"'
    );
  }
  return prompts.select(message, providerOptions(entries));
}
async function resolveModelRef(parsed, deps, prompts, providers, usage, message) {
  const raw = singlePositional(parsed, usage);
  if (raw !== void 0) return parseModelRef(raw);
  if (!interactiveTty(deps)) throw new NeoError("usage", `usage: neo ${usage}`);
  const options = modelOptions(providers);
  if (options.length === 0) {
    throw new NeoError(
      "failure",
      'no models configured yet; add one with "neo model add <provider>/<model>" or run "neo model refresh"'
    );
  }
  return parseModelRef(await prompts.select(message, options));
}
async function resolveModelTarget(parsed, deps, prompts, providers, usage) {
  const raw = singlePositional(parsed, usage);
  if (raw !== void 0) return parseModelRef(raw);
  if (!interactiveTty(deps)) throw new NeoError("usage", `usage: neo ${usage}`);
  const entries = Object.entries(providers);
  if (entries.length === 0) {
    throw new NeoError(
      "failure",
      'no providers yet; add one with "neo model provider add <id> --base-url <url>"'
    );
  }
  const provider = entries.length === 1 ? entries[0][0] : await prompts.select("Add a model to which provider?", providerOptions(entries));
  const model = (await prompts.text({
    message: "Model id (as the provider exposes it)",
    validate: (value) => value.trim().length > 0 ? void 0 : "model id is required"
  })).trim();
  return { provider, model };
}
async function confirmRemoval(io, deps, prompts, parsed, lines) {
  if (parsed.bools.has("yes") || parsed.bools.has("force")) return true;
  if (!interactiveTty(deps)) return true;
  for (const line of lines) io.stdout(`${line}
`);
  return prompts.confirm("proceed with this removal?", false);
}
function parseHeaders(values) {
  const headers = {};
  for (const raw of values) {
    const eq = raw.indexOf("=");
    if (eq <= 0 || eq === raw.length - 1) {
      throw new NeoError("usage", `--header expects key=value (got ${JSON.stringify(raw)})`);
    }
    headers[raw.slice(0, eq)] = raw.slice(eq + 1);
  }
  return headers;
}
async function askEnvRef(prompts, io, current) {
  const answer = (await prompts.text({
    message: "API key env reference (env:VAR; empty for none)",
    ...current !== void 0 ? { initialValue: current } : {},
    validate: (value) => {
      const trimmed = value.trim();
      if (trimmed.length === 0) return void 0;
      return ENV_REF4.test(trimmed) ? void 0 : "must be an env reference such as env:OPENAI_API_KEY";
    }
  })).trim();
  if (answer.length === 0) return void 0;
  if (!ENV_REF4.test(answer)) {
    io.stderr("apiKey must be an env reference (env:VAR); literal keys are never stored\n");
    return void 0;
  }
  return answer;
}
async function fetchForProvider(io, deps, id, provider) {
  const fetchModels = deps.fetchModels ?? nodeFetchPort();
  const auth = resolveProviderAuth(provider, deps.env);
  if (auth.missingEnv.length > 0) {
    io.stderr(
      `warning: cannot read the model list for "${id}": ${auth.missingEnv.map((name) => `env:${name}`).join(", ")} not set; run "neo model refresh ${id}" after exporting it
`
    );
    return void 0;
  }
  const baseUrl = typeof provider.baseUrl === "string" ? provider.baseUrl : void 0;
  if (baseUrl === void 0) return void 0;
  try {
    const result = await fetchModelList(fetchModels, { baseUrl, headers: auth.headers });
    return result.models.map((entry) => withModelDefaults(entry));
  } catch (error) {
    io.stderr(`warning: ${error.message}; run "neo model refresh ${id}" later
`);
    return void 0;
  }
}
async function cmdProviderAdd(args, io, deps) {
  const parsed = parseArgs(args, {
    valued: /* @__PURE__ */ new Set(["base-url", "api", "api-key", "header"]),
    boolean: boolFlags("no-fetch", "json")
  });
  if (parsed.bools.has("json")) {
    throw new NeoError("usage", "model provider add: --json is not available on write commands");
  }
  const isTty = interactiveTty(deps);
  const prompts = deps.prompts ?? defaultPromptPort;
  const rawId = singlePositional(parsed, "model provider add <id>");
  if (rawId === void 0 && !isTty) throw new NeoError("usage", "usage: neo model provider add <id>");
  const id = requireProviderId(
    rawId ?? (await prompts.text({
      message: "Provider id",
      placeholder: "litellm",
      validate: (value) => PROVIDER_ID.test(value.trim()) ? void 0 : `expected ${PROVIDER_ID.source}`
    })).trim()
  );
  const headerValues = parsed.flags.get("header") ?? [];
  const headers = parseHeaders(headerValues);
  let baseUrl = lastFlag(parsed, "base-url");
  let api = lastFlag(parsed, "api");
  let apiKey = lastFlag(parsed, "api-key");
  if (apiKey !== void 0 && !ENV_REF4.test(apiKey)) {
    throw new NeoError("usage", "model provider add: --api-key must be an env reference (env:VAR)");
  }
  if (baseUrl === void 0) {
    if (!isTty) throw new NeoError("usage", "model provider add: --base-url is required when not interactive");
    baseUrl = (await prompts.text({
      message: "API base URL (include the /v1 suffix)",
      placeholder: "https://litellm.example/v1",
      validate: (value) => /^https?:\/\/\S+$/i.test(value.trim()) ? void 0 : "must start with http:// or https://"
    })).trim();
  }
  if (api === void 0) {
    api = isTty ? (await prompts.text({
      message: "API protocol",
      initialValue: DEFAULT_API,
      defaultValue: DEFAULT_API
    })).trim() : DEFAULT_API;
  }
  if (apiKey === void 0 && isTty) apiKey = await askEnvRef(prompts, io, void 0);
  const provider = {
    baseUrl,
    api,
    ...apiKey !== void 0 ? { apiKey } : {},
    ...Object.keys(headers).length > 0 ? { headers } : {}
  };
  const readNow = !parsed.bools.has("no-fetch") && (!isTty || await prompts.confirm("Read the model list now?", true));
  const models = readNow ? await fetchForProvider(io, deps, id, provider) ?? [] : [];
  if (readNow && models.length === 0) {
    io.stderr(`warning: no models discovered for "${id}"; add them with "neo model add ${id}/<model>"
`);
  }
  const home = resolveHome(deps);
  await withHomeLock(home, async () => {
    const loaded = await readConfig(home);
    if (hasProvider(loaded, id)) {
      throw new NeoError("state", `provider "${id}" already exists (use "neo model provider edit ${id}")`);
    }
    await writeConfig(home, upsertProvider(loaded, id, { ...provider, models }));
  });
  io.stdout(`added provider "${id}" (${models.length} model(s))
`);
  for (const entry of models) io.stdout(`  ${entry.id}  ${describeModel(entry)}
`);
  return 0;
}
async function cmdProviderEdit(args, io, deps) {
  const parsed = parseArgs(args, {
    valued: /* @__PURE__ */ new Set(["base-url", "api", "api-key", "header", "rm-header"]),
    boolean: boolFlags("json")
  });
  if (parsed.bools.has("json")) {
    throw new NeoError("usage", "model provider edit: --json is not available on write commands");
  }
  const home = resolveHome(deps);
  const before = await readConfig(home);
  const prompts = deps.prompts ?? defaultPromptPort;
  const id = await resolveProviderId(
    parsed,
    deps,
    prompts,
    "model provider edit <id>",
    Object.entries(before.config.providers),
    "Edit which provider?"
  );
  const current = before.config.providers[id];
  if (current === void 0) throw new NeoError("failure", `unknown provider "${id}"`);
  const setHeaders = parseHeaders(parsed.flags.get("header") ?? []);
  const rmHeaders = parsed.flags.get("rm-header") ?? [];
  let baseUrl = lastFlag(parsed, "base-url");
  let api = lastFlag(parsed, "api");
  let apiKey = lastFlag(parsed, "api-key");
  const hasFlags = baseUrl !== void 0 || api !== void 0 || apiKey !== void 0 || Object.keys(setHeaders).length > 0 || rmHeaders.length > 0;
  if (!hasFlags) {
    if (!interactiveTty(deps)) {
      throw new NeoError("usage", "model provider edit: pass at least one field flag when not interactive");
    }
    baseUrl = (await prompts.text({
      message: "API base URL",
      initialValue: typeof current.baseUrl === "string" ? current.baseUrl : "",
      validate: (value) => /^https?:\/\/\S+$/i.test(value.trim()) ? void 0 : "must start with http:// or https://"
    })).trim();
    api = (await prompts.text({
      message: "API protocol",
      initialValue: typeof current.api === "string" ? current.api : DEFAULT_API
    })).trim();
    apiKey = await askEnvRef(prompts, io, typeof current.apiKey === "string" ? current.apiKey : void 0);
  }
  if (apiKey !== void 0 && !ENV_REF4.test(apiKey)) {
    throw new NeoError("usage", "model provider edit: --api-key must be an env reference (env:VAR)");
  }
  await withHomeLock(home, async () => {
    const loaded = await readConfig(home);
    const provider = loaded.config.providers[id];
    if (provider === void 0) throw new NeoError("failure", `unknown provider "${id}"`);
    const headers = {
      ...provider.headers !== void 0 ? provider.headers : {}
    };
    Object.assign(headers, setHeaders);
    for (const key of rmHeaders) delete headers[key];
    const next = { ...provider };
    if (baseUrl !== void 0) next.baseUrl = baseUrl;
    if (api !== void 0) next.api = api;
    if (apiKey !== void 0) next.apiKey = apiKey;
    if (Object.keys(headers).length > 0) next.headers = headers;
    else delete next.headers;
    await writeConfig(home, upsertProvider(loaded, id, next));
  });
  io.stdout(`updated provider "${id}"
`);
  return 0;
}
async function roleRefs(home, predicate) {
  const roles = await listRoles(home, null);
  const refs = [];
  for (const role of roles) {
    try {
      const models = await readRoleModels(home, role.name);
      if (models.default !== void 0 && predicate(models.default)) refs.push(role.name);
    } catch {
    }
  }
  return refs;
}
async function cmdProviderRemove(args, io, deps) {
  const parsed = parseArgs(args, { valued: /* @__PURE__ */ new Set(), boolean: boolFlags("force", "json") });
  if (parsed.bools.has("json")) {
    throw new NeoError("usage", "model provider rm: --json is not available on write commands");
  }
  const home = resolveHome(deps);
  const before = await readConfig(home);
  const prompts = deps.prompts ?? defaultPromptPort;
  const id = await resolveProviderId(
    parsed,
    deps,
    prompts,
    "model provider rm <id>",
    Object.entries(before.config.providers),
    "Remove which provider?"
  );
  const force = parsed.bools.has("force");
  if (!hasProvider(before, id)) throw new NeoError("failure", `unknown provider "${id}"`);
  const configRef = providerReferencedByDefault(before, id);
  const roles = await roleRefs(home, (ref) => ref.provider === id);
  if (!force && (configRef || roles.length > 0)) {
    const refs = [
      ...configRef ? ["config.defaultModel"] : [],
      ...roles.map((role) => `roles/${role}/models.yaml`)
    ];
    throw new NeoError(
      "failure",
      `provider "${id}" is still referenced by ${refs.join(", ")}; pick another default or pass --force`
    );
  }
  const models = providerModels(before.config.providers[id]);
  if (!await confirmRemoval(io, deps, prompts, parsed, [
    `will remove provider "${id}" and ${models.length} model(s)`,
    ...models.map((model) => `  ${model.id}  ${describeModel(model)}`)
  ])) {
    io.stderr("aborted, nothing removed\n");
    return 0;
  }
  await withHomeLock(home, async () => {
    const loaded = await readConfig(home);
    if (!hasProvider(loaded, id)) throw new NeoError("failure", `unknown provider "${id}"`);
    await writeConfig(home, removeProvider(loaded, id));
  });
  io.stdout(`removed provider "${id}"${configRef ? " and cleared config.defaultModel" : ""}
`);
  if (roles.length > 0) {
    io.stderr(
      `warning: role default(s) still point at "${id}": ${roles.join(", ")}; update roles/<role>/models.yaml before launching those roles
`
    );
  }
  return 0;
}
async function cmdRefresh(args, io, deps) {
  const parsed = parseArgs(args, { valued: /* @__PURE__ */ new Set(), boolean: boolFlags("dry-run", "prune", "json") });
  if (parsed.bools.has("json")) {
    throw new NeoError("usage", "model refresh: --json is not available (use --dry-run + read output)");
  }
  const target = parsed.positionals[0];
  if (parsed.positionals.length > 1) throw new NeoError("usage", "model refresh: at most one provider id");
  const dryRun = parsed.bools.has("dry-run");
  const prune = parsed.bools.has("prune");
  const home = resolveHome(deps);
  const { config } = await readConfig(home);
  const ids = target === void 0 ? Object.keys(config.providers) : [requireProviderId(target)];
  for (const id of ids) {
    if (config.providers[id] === void 0) {
      throw new NeoError("failure", `unknown provider "${id}"`);
    }
  }
  const discovered = /* @__PURE__ */ new Map();
  for (const id of ids) {
    const provider = config.providers[id];
    const models = await fetchForProvider(io, deps, id, provider);
    if (models !== void 0) discovered.set(id, models);
  }
  if (discovered.size === 0) {
    io.stderr("nothing refreshed (no provider could be read)\n");
    return 1;
  }
  const plans = [];
  for (const [id, models] of discovered) {
    const provider = config.providers[id];
    const report = mergeDiscoveredModels(providerModels(provider), models, { prune });
    plans.push({ id, ...report });
  }
  if (dryRun) {
    for (const plan of plans) {
      io.stdout(
        `${plan.id}: +${plan.added.length} new, ${plan.kept.length} kept, ${plan.vanished.length} gone from upstream${prune ? " (pruned)" : " (kept)"}
`
      );
      for (const id of plan.added) io.stdout(`  + ${id}
`);
      for (const id of plan.vanished) io.stdout(`  - ${id} (upstream)
`);
    }
    return 0;
  }
  const defaultBefore = config.defaultModel;
  if (prune && defaultBefore !== void 0) {
    const owner = plans.find((plan) => plan.id === defaultBefore.provider);
    if (owner !== void 0 && owner.vanished.includes(defaultBefore.model)) {
      throw new NeoError(
        "failure",
        `refusing to prune "${defaultBefore.provider}/${defaultBefore.model}": it is config.defaultModel`
      );
    }
  }
  await withHomeLock(home, async () => {
    let loaded = await readConfig(home);
    for (const plan of plans) {
      const provider = loaded.config.providers[plan.id];
      if (provider === void 0) continue;
      const fresh = mergeDiscoveredModels(providerModels(provider), discovered.get(plan.id) ?? [], { prune });
      loaded = setProviderModels(loaded, plan.id, fresh.models);
    }
    await writeConfig(home, loaded);
  });
  for (const plan of plans) {
    io.stdout(
      `${plan.id}: +${plan.added.length} new, ${plan.kept.length} kept, ${plan.vanished.length} gone from upstream${prune ? " (pruned)" : " (kept; use --prune to drop)"}
`
    );
    for (const id of plan.added) io.stdout(`  + ${id}
`);
  }
  return 0;
}
function parseModelRef(raw) {
  const slash = raw.indexOf("/");
  if (slash <= 0 || slash === raw.length - 1) {
    throw new NeoError("usage", `expected "<provider>/<model>" (got ${JSON.stringify(raw)})`);
  }
  return { provider: raw.slice(0, slash), model: raw.slice(slash + 1) };
}
function parseCliTokens(value, field) {
  try {
    return parseTokenCount(value, field);
  } catch (error) {
    throw new NeoError("usage", error.message);
  }
}
function parseInputList(raw) {
  const parts = raw.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  const out = [];
  for (const part of parts) {
    if (part !== "text" && part !== "image") {
      throw new NeoError("usage", `--input entries must be "text" or "image" (got ${JSON.stringify(part)})`);
    }
    if (!out.includes(part)) out.push(part);
  }
  if (out.length === 0) throw new NeoError("usage", "--input needs at least one modality (text, image)");
  return out;
}
function parseLevelList(raw) {
  const parts = raw.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  const out = [];
  for (const part of parts) {
    if (!THINKING_LEVELS.includes(part)) {
      throw new NeoError("usage", `--thinking-levels entries must be one of: ${THINKING_LEVELS.join(",")}`);
    }
    out.push(part);
  }
  if (out.includes("off") && out.includes("none")) {
    throw new NeoError("usage", '--thinking-levels cannot contain both "off" and "none"');
  }
  return out;
}
function collectModelFields(parsed) {
  const fields = {};
  let touched = false;
  const name = lastFlag(parsed, "name");
  if (name !== void 0) {
    fields.name = name;
    touched = true;
  }
  const context = lastFlag(parsed, "context");
  if (context !== void 0) {
    fields.contextWindow = parseCliTokens(context, "contextWindow");
    touched = true;
  }
  const maxTokens = lastFlag(parsed, "max-tokens");
  if (maxTokens !== void 0) {
    fields.maxTokens = parseCliTokens(maxTokens, "maxTokens");
    touched = true;
  }
  const input = lastFlag(parsed, "input");
  if (input !== void 0) {
    fields.input = parseInputList(input);
    touched = true;
  }
  if (parsed.bools.has("reasoning")) {
    fields.reasoning = true;
    touched = true;
  }
  if (parsed.bools.has("no-reasoning")) {
    fields.reasoning = false;
    touched = true;
  }
  const levels = lastFlag(parsed, "thinking-levels");
  if (levels !== void 0) {
    fields.thinkingLevels = parseLevelList(levels);
    touched = true;
  }
  const level = lastFlag(parsed, "thinking-level");
  if (level !== void 0) {
    if (!THINKING_LEVELS.includes(level)) {
      throw new NeoError("usage", `--thinking-level must be one of: ${THINKING_LEVELS.join(",")}`);
    }
    fields.thinkingLevel = level;
    touched = true;
  }
  return touched ? fields : void 0;
}
function applyFields(entry, fields) {
  const next = { ...entry };
  if (fields.name !== void 0) next.name = fields.name;
  if (fields.contextWindow !== void 0) next.contextWindow = fields.contextWindow;
  if (fields.maxTokens !== void 0) next.maxTokens = fields.maxTokens;
  if (fields.input !== void 0) next.input = [...fields.input];
  if (fields.reasoning !== void 0) next.reasoning = fields.reasoning;
  if (fields.thinkingLevels !== void 0) next.thinkingLevels = [...fields.thinkingLevels];
  if (fields.thinkingLevel !== void 0) next.thinkingLevel = fields.thinkingLevel;
  return next;
}
var MODEL_FLAGS = /* @__PURE__ */ new Set([
  "name",
  "context",
  "max-tokens",
  "input",
  "thinking-levels",
  "thinking-level"
]);
async function cmdModelAdd(args, io, deps) {
  const parsed = parseArgs(args, {
    valued: MODEL_FLAGS,
    boolean: boolFlags("reasoning", "no-reasoning", "json")
  });
  if (parsed.bools.has("json")) {
    throw new NeoError("usage", "model add: --json is not available on write commands");
  }
  const prompts = deps.prompts ?? defaultPromptPort;
  const fields = collectModelFields(parsed) ?? {};
  const home = resolveHome(deps);
  const before = await readConfig(home);
  const ref = await resolveModelTarget(
    parsed,
    deps,
    prompts,
    before.config.providers,
    "model add <provider>/<model>"
  );
  const entry = withModelDefaults(applyFields({ id: ref.model }, fields));
  await withHomeLock(home, async () => {
    const loaded = await readConfig(home);
    const provider = loaded.config.providers[ref.provider];
    if (provider === void 0) throw new NeoError("failure", `unknown provider "${ref.provider}"`);
    if (providerModels(provider).some((model) => model.id === ref.model)) {
      throw new NeoError(
        "failure",
        `model "${ref.provider}/${ref.model}" already exists (use "neo model edit ${ref.provider}/${ref.model}")`
      );
    }
    await writeConfig(home, upsertModel(loaded, ref.provider, entry));
  });
  io.stdout(`added ${ref.provider}/${ref.model}  ${describeModel(entry)}
`);
  warnAgentSpecificLevels(io, entry.thinkingLevels);
  return 0;
}
async function cmdModelRemove(args, io, deps) {
  const parsed = parseArgs(args, { valued: /* @__PURE__ */ new Set(), boolean: boolFlags("force", "json") });
  if (parsed.bools.has("json")) {
    throw new NeoError("usage", "model rm: --json is not available on write commands");
  }
  const home = resolveHome(deps);
  const prompts = deps.prompts ?? defaultPromptPort;
  const before = await readConfig(home);
  const ref = await resolveModelRef(
    parsed,
    deps,
    prompts,
    before.config.providers,
    "model rm <provider>/<model>",
    "Remove which model?"
  );
  const force = parsed.bools.has("force");
  const found = findProviderModel(before.config.providers, ref.provider, ref.model);
  if (found === void 0) throw new NeoError("failure", `unknown model "${ref.provider}/${ref.model}"`);
  const isDefault = modelReferencedByDefault(before, ref.provider, ref.model);
  if (isDefault && !force) {
    throw new NeoError(
      "failure",
      `"${ref.provider}/${ref.model}" is config.defaultModel; pick another with "neo model use" or pass --force`
    );
  }
  const roles = await roleRefs(
    home,
    (defaults) => defaults.provider === ref.provider && defaults.model === ref.model
  );
  if (!await confirmRemoval(io, deps, prompts, parsed, [
    `will remove ${ref.provider}/${ref.model}  ${describeModel(found.model)}`
  ])) {
    io.stderr("aborted, nothing removed\n");
    return 0;
  }
  await withHomeLock(home, async () => {
    const loaded = await readConfig(home);
    await writeConfig(home, removeModel(loaded, ref.provider, ref.model, { force }));
  });
  io.stdout(`removed ${ref.provider}/${ref.model}${isDefault ? " and cleared config.defaultModel" : ""}
`);
  if (roles.length > 0) {
    io.stderr(
      `warning: role default(s) still point at this model: ${roles.join(", ")}; update roles/<role>/models.yaml
`
    );
  }
  return 0;
}
async function promptModelFields(prompts, current) {
  const base = withModelDefaults(current);
  const name = (await prompts.text({ message: "Display name", initialValue: base.name ?? base.id })).trim();
  const contextRaw = (await prompts.text({
    message: "Context window (128000 / 512K / 1M)",
    initialValue: String(base.contextWindow ?? DEFAULT_CONTEXT_WINDOW),
    validate: (value) => {
      try {
        parseTokenCount(value, "contextWindow");
        return void 0;
      } catch (error) {
        return error.message;
      }
    }
  })).trim();
  const maxRaw = (await prompts.text({
    message: "Max output tokens (empty = agent default)",
    initialValue: base.maxTokens !== void 0 ? String(base.maxTokens) : ""
  })).trim();
  const input = await prompts.multiselect(
    "Input modalities",
    [
      { value: "text", label: "text" },
      { value: "image", label: "image" }
    ],
    base.input ?? ["text"]
  );
  const reasoning = await prompts.confirm("Supports reasoning (thinking)?", base.reasoning ?? true);
  const levels = await prompts.multiselect(
    "Thinking levels available",
    THINKING_LEVELS.map((level) => ({ value: level, label: level })),
    base.thinkingLevels ?? []
  );
  let thinkingLevel;
  if (levels.length > 0) {
    const chosen = await prompts.select(
      "Startup thinking level",
      [
        { value: "", label: "(agent default)" },
        ...levels.map((level) => ({ value: level, label: level }))
      ],
      base.thinkingLevel ?? ""
    );
    thinkingLevel = chosen === "" ? void 0 : chosen;
  }
  const next = {
    ...current,
    name,
    contextWindow: parseCliTokens(contextRaw, "contextWindow"),
    input,
    reasoning,
    thinkingLevels: levels,
    ...maxRaw.length > 0 ? { maxTokens: parseCliTokens(maxRaw, "maxTokens") } : {},
    ...thinkingLevel !== void 0 ? { thinkingLevel } : {}
  };
  if (maxRaw.length === 0) delete next.maxTokens;
  if (thinkingLevel === void 0) delete next.thinkingLevel;
  return next;
}
async function cmdModelEdit(args, io, deps) {
  const parsed = parseArgs(args, {
    valued: MODEL_FLAGS,
    boolean: boolFlags("reasoning", "no-reasoning", "json")
  });
  if (parsed.bools.has("json")) {
    throw new NeoError("usage", "model edit: --json is not available on write commands");
  }
  const home = resolveHome(deps);
  const before = await readConfig(home);
  const prompts = deps.prompts ?? defaultPromptPort;
  const ref = await resolveModelRef(
    parsed,
    deps,
    prompts,
    before.config.providers,
    "model edit <provider>/<model>",
    "Edit which model?"
  );
  const found = findProviderModel(before.config.providers, ref.provider, ref.model);
  if (found === void 0) throw new NeoError("failure", `unknown model "${ref.provider}/${ref.model}"`);
  const fields = collectModelFields(parsed);
  let next;
  if (fields === void 0) {
    if (!interactiveTty(deps)) {
      throw new NeoError("usage", "model edit: pass at least one field flag when not interactive");
    }
    const edited = await promptModelFields(prompts, found.model);
    if (edited === null) {
      io.stderr("aborted, nothing written\n");
      return 0;
    }
    const confirmed = await prompts.confirm(`Save ${ref.provider}/${ref.model}?`, true);
    if (!confirmed) {
      io.stderr("aborted, nothing written\n");
      return 0;
    }
    next = edited;
  } else {
    next = applyFields(found.model, fields);
  }
  await withHomeLock(home, async () => {
    const loaded = await readConfig(home);
    const current = findProviderModel(loaded.config.providers, ref.provider, ref.model);
    if (current === void 0) {
      throw new NeoError("failure", `model "${ref.provider}/${ref.model}" disappeared; re-read with "neo model list"`);
    }
    await writeConfig(home, upsertModel(loaded, ref.provider, next));
  });
  io.stdout(`updated ${ref.provider}/${ref.model}  ${describeModel(next)}
`);
  warnAgentSpecificLevels(io, next.thinkingLevels);
  return 0;
}
async function cmdModelUse(args, io, deps) {
  const parsed = parseArgs(args, { valued: /* @__PURE__ */ new Set(), boolean: boolFlags("json") });
  if (parsed.bools.has("json")) {
    throw new NeoError("usage", "model use: --json is not available on write commands");
  }
  const home = resolveHome(deps);
  const prompts = deps.prompts ?? defaultPromptPort;
  const before = await readConfig(home);
  const ref = await resolveModelRef(
    parsed,
    deps,
    prompts,
    before.config.providers,
    "model use <provider>/<model>",
    "Set which model as default?"
  );
  await withHomeLock(home, async () => {
    const loaded = await readConfig(home);
    await writeConfig(home, setDefaultModel(loaded, ref));
  });
  io.stdout(`default model: ${ref.provider}/${ref.model}
`);
  return 0;
}
var MODEL_USAGE = [
  "neo model",
  "neo model provider                (TTY: interactive provider menu; add/edit/refresh/remove in one session)",
  "neo model provider add [<id>] --base-url <url> [--api <api>] [--api-key env:VAR] [--header k=v]\u2026 [--no-fetch]",
  "neo model provider list [--json]",
  "neo model provider edit [<id>] [--base-url \u2026] [--api \u2026] [--api-key env:VAR] [--header k=v]\u2026 [--rm-header k]\u2026",
  "neo model provider rm [<id>] [--force|--yes]",
  "neo model refresh [<provider>] [--dry-run] [--prune]",
  "neo model add [<provider>/<model>] [--name \u2026] [--context 1M] [--max-tokens 16K] [--input text,image] [--reasoning|--no-reasoning] [--thinking-levels low,high,max] [--thinking-level high]",
  "neo model edit [<provider>/<model>] [\u540C\u4E0A\u5B57\u6BB5 flags;\u65E0 flags \u65F6\u8FDB\u5165\u4EA4\u4E92\u7F16\u8F91]",
  "neo model rm [<provider>/<model>] [--force|--yes]",
  "neo model use [<provider>/<model>]"
];
var MODEL_FLAGS_HELP = [
  "--base-url <url>        provider API base URL (include /v1)",
  "--api <api>             Pi api id (default: openai-completions)",
  "--api-key env:VAR       API key env reference; literal keys are never stored",
  "--header k=v            extra request header (repeatable; sensitive keys must be env:VAR)",
  "--no-fetch              do not read /v1/models on add",
  "--context <size>        128000 / 512K / 1M (default 1M)",
  "--max-tokens <size>     output token cap (default: agent default)",
  "--input text,image      input modalities (default: text,image)",
  "--reasoning/--no-reasoning  whether the model supports thinking (default: yes)",
  "--thinking-levels a,b   available levels (default: low,high,max)",
  "--thinking-level <lvl>  startup level (must be listed in --thinking-levels)",
  "--force                 override references when removing (also skips the confirmation)",
  "--yes                   skip the interactive removal confirmation",
  "--dry-run               refresh: preview only",
  "--prune                 refresh: drop models that disappeared upstream"
];

// packages/cli/src/cli.ts
function defaultCliDeps() {
  return {
    env: process.env,
    homedir: os4.homedir(),
    exec: nodeExecPort(),
    now: () => /* @__PURE__ */ new Date()
  };
}
var COMMANDS = [
  {
    name: "init",
    summary: "interactive bootstrap: write the config skeleton, import existing global skills",
    usage: ["neo init"],
    flags: []
  },
  {
    name: "target",
    summary: 'legacy global mount targets (only needed for "neo use --global"); list/add/remove',
    usage: [
      "neo target",
      "neo target add <agent-id> [--skills-dir <path>] [--agents-md]",
      "neo target remove <agent-id>"
    ],
    flags: [
      "--skills-dir <path>  override the agent skills directory (default: registry)",
      "--agents-md          opt in to instruction-file management for this target"
    ]
  },
  {
    name: "migrate",
    summary: "absorb existing npx skills installs into neo roles (bare run = preview)",
    usage: [
      "neo migrate [--apply] [--yes] [--strategy first|newest|skip] [--scan-agents] [--absorb-links] [--role <name>] [--json]"
    ],
    flags: [
      "--apply              execute the plan (no extra confirmation)",
      "--strategy <name>    conflict winner: first | newest | skip (default: first)",
      "--scan-agents        scan agent skill dirs for unmanaged installs",
      "--absorb-links       absorb registry-scope links pointing into neo home",
      '--role <name>        target role (preview defaults to "default"; required with --apply)'
    ]
  },
  {
    name: "create",
    summary: "create an empty role (skills/ + AGENTS.md placeholder stub)",
    usage: ["neo create <name>"],
    flags: []
  },
  {
    name: "role",
    summary: "write role assembly: AGENTS.md body, role.yaml domains, mcp.yaml (create only writes the stub)",
    usage: ["neo role set <role> [--agents-md <file>|'-'] [--domains a,b] [--mcp <file>|'-'] [--dry-run] [--json]"],
    flags: [
      "--agents-md <file>   replace roles/<role>/AGENTS.md body ('-' = stdin)",
      "--domains a,b        overwrite role.yaml domains (empty value clears the list, keeps the file)",
      "--mcp <file>         replace mcp.yaml ('-' = stdin); credential-looking values must be env:VAR refs",
      "--dry-run            print unified diffs; write nothing"
    ]
  },
  {
    name: "list",
    aliases: ["ls"],
    summary: "list roles (default), skills, library domains, or known agents (registry + targets + detection)",
    usage: ["neo list [roles|skills|domains|agents] [--role <name>] [--json]"],
    flags: ['--role <name>  filter (applies to "list skills" only)']
  },
  {
    name: "add",
    summary: "install skills from a single source into a role, or into a library domain (--domain)",
    usage: ["neo add <source> --role <name> [--skill|-s <skill>\u2026|*] [-l]", "neo add <source> --domain <name> [--skill|-s <skill>\u2026|*] [-l]"],
    flags: [
      "--skill, -s <skill>  skill to install (repeatable; comma-separated; * = all)",
      "--role <name>        target role (no implicit default \u2014 TTY shows a picker; mutually exclusive with --domain)",
      "--domain <name>      target library domain: skills land in library/<name> (no role lock; mutually exclusive with --role)",
      "-l                   list source skills and exit (upstream text, passed through)",
      '                     (without --skill/-s: TTY multi-select with an "(all N skills)" option,',
      "                      a = all / i = invert; non-TTY requires a flag)"
    ]
  },
  {
    name: "update",
    summary: "refresh installed skills from their sources (per-source re-add + hash compare)",
    usage: ["neo update [--role <name>\u2026] [--dry-run] [--json]"],
    flags: [
      "--role <name>  roles to update (repeatable; default: all locked roles)",
      "--dry-run      four-state preview (unchanged / update / gone-from-source / would-install)"
    ]
  },
  {
    name: "remove",
    aliases: ["rm"],
    summary: "remove skills from a role and re-converge mounts (the only TTY confirmation)",
    usage: ["neo remove <skills\u2026> --role <name> [--yes]"],
    flags: [
      "--role <name>  source role (required; no implicit default \u2014 TTY shows a picker)",
      "--yes          skip the TTY confirmation (required when not interactive)"
    ]
  },
  {
    name: "use",
    summary: "set the default role for neo run (no global writes); --global mounts into agent dirs",
    usage: ["neo use <role>", "neo use <role> --global [--force]", "neo use <role> --project [--link]"],
    flags: [
      "--global    also mount default \u222A role into configured agent dirs (0.1.x behavior)",
      "--force     overwrite conflicting global links (D/E only; never real content)",
      "--project   bind the role to the current project (manifest + materialize)",
      "--link      project materialize mode = junction/symlink (with --project only)"
    ]
  },
  {
    name: "run",
    summary: "launch an agent with a role-scoped isolated config root (default role: activeRole)",
    usage: ["neo run <agent> [--role <name>] [--isolated] [--ephemeral] [--force] [-- <agent-args>\u2026]"],
    flags: [
      "--role <name>   role to launch (default: project binding, else activeRole, else default)",
      "--isolated      hide user-global skills where the agent supports it (best effort)",
      "--ephemeral     use a throwaway root (removed on exit; no history kept)",
      "--force         allow --role to differ from a project binding (mixing is on you)",
      "--headless      DSH only: one-shot headless profile (task after --)",
      "--acp           DSH only: ACP stdio profile",
      '--agent-models  skip the "configure a model provider first" gate and let the agent',
      "                use its own model config/login (neo writes no model files)",
      "--              everything after is passed to the agent verbatim"
    ]
  },
  {
    name: "off",
    summary: "clear the default role; --global unmounts agent dirs; --project unbinds a project",
    usage: ["neo off", "neo off --global", "neo off --project [--role <name>\u2026]"],
    flags: [
      "--global       unmount legacy/global links (0.1.x behavior)",
      "--project      unbind the current project (strip blocks, remove manifest)",
      "--role <name>  project roles to unbind (repeatable; default: all)"
    ]
  },
  {
    name: "roots",
    summary: "list role launch roots; --clean removes them (never touches roles or skills)",
    usage: ["neo roots", "neo roots --clean <role>"],
    flags: [
      "--clean <role>  remove roots/<role>/ (auth copies + agent session history included)"
    ]
  },
  {
    name: "materialize",
    summary: "export a role\xD7agent launch root (resources only) to an external dir; never launches",
    usage: ["neo materialize --role <name> --agent <agent-id> --out <dir> [--no-auth] [--agent-models] [--json]"],
    flags: [
      "--role <name>   role to assemble (required; default \u222A domain \u222A role, role > domain > default)",
      "--agent <id>    launchable agent id (required; see: neo list agents)",
      "--out <dir>     MUST be a dir owned by this command (root.json marker): export into a dedicated",
      "                subdir, never an existing agent config root; foreign content refused (staged + swapped)",
      "--no-auth       exclude auth credential copies from the export (manifest authExcluded: true);",
      "                default keeps them (same shape as the launch root); external hosts pass this",
      "--agent-models  skip neo model rendering \u2014 host supplies its own models",
      '                (manifest model: { file: null, owner: "host", reason })'
    ]
  },
  {
    name: "sync",
    summary: "project materialization preview (bare run) / apply",
    usage: ["neo sync [--apply] [--force] [--json]"],
    flags: [
      "--apply   execute the plan (skip hand-edited copies unless --force)",
      "--force   overwrite project-edited copies"
    ]
  },
  {
    name: "status",
    summary: "offline local audit (global mounts + launch roots + capability matrix)",
    usage: ["neo status [--json]"],
    flags: []
  },
  {
    name: "model",
    summary: "model providers and models: list/add/edit/remove/refresh (config.yaml)",
    usage: MODEL_USAGE,
    flags: MODEL_FLAGS_HELP
  }
];
var JSON_MATRIX = /* @__PURE__ */ new Set(["status", "list", "role", "migrate", "sync", "update", "model", "materialize"]);
function resolveCommand2(name) {
  return COMMANDS.find(
    (spec) => spec.name === name || spec.aliases?.includes(name)
  );
}
function helpHome(deps) {
  try {
    return resolveNeoHome({ env: deps.env, homedir: deps.homedir });
  } catch {
    return "<neo-home>";
  }
}
async function launchableIds(deps) {
  try {
    return launchableAgentIds(await readRegistry(helpHome(deps)));
  } catch {
    return launchableAgentIds(BUILTIN_AGENTS);
  }
}
async function printFullHelp(io, deps) {
  const lines = [`neo ${NEO_VERSION} \u2014 cross-agent skill role manager`, ""];
  lines.push("usage: neo <command> [options]", "", "quick start: neo init  ->  neo run <agent>", "", "commands:");
  for (const spec of COMMANDS) {
    const alias = spec.aliases !== void 0 && spec.aliases.length > 0 ? ` (alias: ${spec.aliases.join(", ")})` : "";
    lines.push(`  ${spec.name.padEnd(10)} ${spec.summary}${alias}`);
  }
  lines.push(
    "",
    `run launches: ${(await launchableIds(deps)).join(", ")}`,
    '(other known agents: bind a repo with "neo use <role> --project" or mount with "neo use <role> --global"; see neo list agents)',
    "",
    "global flags:",
    "  --version   print version and exit",
    "  --help      show this help (per command: neo <command> --help)",
    "  --yes       assume yes (v1: only remove consumes it; elsewhere a no-op)",
    "  --json      machine output (only: status, list, role, update --dry-run, migrate, sync, materialize)",
    "",
    "aliases: ls \u2192 list \xB7 rm \u2192 remove",
    `home: ${helpHome(deps)} (override with NEO_HOME)`
  );
  io.stdout(`${lines.join("\n")}
`);
}
async function printCommandHelp(io, spec, deps) {
  const lines = [`usage: ${spec.usage[0]}`];
  for (const usage of spec.usage.slice(1)) lines.push(`       ${usage}`);
  lines.push("", spec.summary);
  if (spec.name === "run") {
    lines.push("", `agents neo run can launch: ${(await launchableIds(deps)).join(", ")}`);
    lines.push('  other known agents: bind a repo with "neo use <role> --project" or mount with "neo use <role> --global"');
    lines.push("  detection status and why the rest cannot launch: neo list agents");
  }
  if (spec.aliases !== void 0 && spec.aliases.length > 0) {
    lines.push("", `aliases: ${spec.aliases.join(", ")}`);
  }
  if (spec.flags.length > 0) {
    lines.push("", "flags:");
    for (const flag of spec.flags) lines.push(`  ${flag}`);
  }
  lines.push("", "global flags: --version, --help, --yes (no-op unless listed above)");
  lines.push(
    JSON_MATRIX.has(spec.name) ? "--json: available (machine output on stdout)" : "--json: not available (machine output is for read-only/preview commands only)"
  );
  io.stdout(`${lines.join("\n")}
`);
}
async function runCli(argv, io, deps = defaultCliDeps()) {
  const boundary = argv.indexOf("--");
  const head = boundary === -1 ? argv : argv.slice(0, boundary);
  if (head.includes("--version")) {
    io.stdout(`${NEO_VERSION}
`);
    return 0;
  }
  if (head.includes("--help")) {
    const spec = resolveCommand2(head[0] ?? "");
    if (spec !== void 0) await printCommandHelp(io, spec, deps);
    else await printFullHelp(io, deps);
    return 0;
  }
  try {
    const home = resolveHome(deps);
    if (argv[0] === "model") return await dispatch(argv, io, deps);
    return await withHomeLock(home, () => dispatch(argv, io, deps));
  } catch (error) {
    if (error instanceof PromptCanceled) {
      io.stderr("neo: canceled\n");
      return 130;
    }
    return reportError(io, error);
  }
}
async function dispatch(argv, io, deps) {
  const name = argv[0];
  if (name === void 0) {
    io.stderr('usage: neo <command> [options]\nrun "neo --help" for the command list\n');
    return 2;
  }
  if (name === "upgrade") {
    throw new NeoError(
      "usage",
      "upgrade is reserved for future schema upgrades and is not implemented in v1 (all neo files remain version 1)"
    );
  }
  const spec = resolveCommand2(name);
  if (spec === void 0) {
    throw new NeoError("usage", `unknown command "${name}" (run "neo --help" for the command list)`);
  }
  const rest = argv.slice(1);
  if (!JSON_MATRIX.has(spec.name) && rest.some((a2) => a2 === "--json" || a2.startsWith("--json="))) {
    throw new NeoError(
      "usage",
      `${spec.name}: --json is not available (machine output only on: ${[...JSON_MATRIX].join(", ")})`
    );
  }
  switch (spec.name) {
    case "init":
      return cmdInit(rest, io, deps);
    case "target":
      return cmdTarget(rest, io, deps);
    case "migrate":
      return cmdMigrate(rest, io, deps);
    case "create":
      return cmdCreate(rest, io, deps);
    case "role":
      return cmdRole(rest, io, deps);
    case "list":
      return cmdList(rest, io, deps);
    case "add":
      return cmdAdd(rest, io, deps);
    case "update":
      return cmdUpdate(rest, io, deps);
    case "remove":
      return cmdRemove(rest, io, deps);
    case "use":
      return cmdUse(rest, io, deps);
    case "run":
      return cmdRun(rest, io, deps);
    case "off":
      return cmdOff(rest, io, deps);
    case "roots":
      return cmdRoots(rest, io, deps);
    case "materialize":
      return cmdMaterialize(rest, io, deps);
    case "sync":
      return cmdSync(rest, io, deps);
    case "status":
      return cmdStatus(rest, io, deps);
    case "model":
      return cmdModel(rest, io, deps);
  }
  throw new NeoError("usage", `unknown command "${name}"`);
}
async function cmdInit(args, io, deps) {
  const parsed = parseArgs(args, { valued: /* @__PURE__ */ new Set(), boolean: boolFlags() });
  if (parsed.positionals.length > 0) throw new NeoError("usage", "init: takes no positional arguments");
  const isTty = interactiveTty(deps);
  if (!isTty) {
    throw new NeoError(
      "usage",
      "init requires an interactive terminal; write the config skeleton by hand (see docs/schema/neo-home.md)"
    );
  }
  const home = resolveHome(deps);
  const loaded = await readConfig(home);
  const registry = await readRegistry(home);
  const port = deps.detect ?? nodeDetectPort();
  const detections = await detectAgents(registry, deps.homedir, port);
  const detected = detections.filter((detection) => detection.signals.length > 0);
  io.stdout(`neo init: ${home}
`);
  if (home !== path26.join(deps.homedir, "neo")) {
    try {
      await fs28.stat(path26.join(deps.homedir, "neo", "config.yaml"));
      io.stderr(
        "hint: legacy home ~/neo still exists; this version uses ~/.neo \u2014 move it (mv ~/neo ~/.neo) or set NEO_HOME=~/neo\n"
      );
    } catch {
    }
  }
  if (loaded.config.targets.length > 0) {
    io.stdout(
      `existing targets (legacy global mounts): ${loaded.config.targets.map((target) => target.agent).join(", ")}
`
    );
  }
  if (await ensureConfigSkeleton(home)) {
    io.stdout(`wrote config skeleton: ${configPath(home)}
`);
  }
  if (detected.length > 0) {
    io.stdout(`detected: ${detected.map((detection) => detection.id).join(", ")}
`);
  } else {
    io.stdout('no agents detected; see "neo list agents" for the full registry\n');
  }
  const importExit = await importExistingSkills(home, io, deps);
  if (importExit !== 0) return importExit;
  await setupGitSync(home, io, deps);
  io.stdout('next: add skills with "neo add <source> --skill <skill>", then launch with "neo run <agent>"\n');
  return 0;
}
async function setupGitSync(home, io, deps) {
  const scope = await detectRepoScope(home);
  if (scope === "home") {
    io.stdout("git: home is already a git repo; left untouched\n");
    return;
  }
  if (scope === "parent") {
    io.stdout("git: home is inside another git worktree; no nested repo created\n");
    return;
  }
  const files = await ensureSyncFiles(home);
  if (files.written.length > 0) io.stdout(`wrote ${files.written.join(", ")}
`);
  if (!await gitAvailable(deps.exec, home)) {
    io.stderr("warning: git is not runnable from neo; sync skipped (ignore files are in place)\n");
    return;
  }
  const ask = deps.ask ?? promptAsk;
  const confirm2 = deps.confirm ?? promptConfirm;
  const enabled = await confirm2("enable git-based sync for this home? (requires a remote URL)", false);
  if (!enabled) {
    io.stdout('git sync not enabled; ignore files are ready for a later "git init"\n');
    return;
  }
  const remote = (await ask("remote URL (leave empty to skip repo creation):", "")).trim();
  if (remote.length === 0) {
    io.stdout("no remote URL; no git repo created (ignore files are ready)\n");
    return;
  }
  try {
    validateRemoteUrl(remote);
  } catch (error) {
    io.stderr(`${error.message}
`);
    return;
  }
  const report = await gitSync(home, { remote, exec: deps.exec });
  for (const warning of report.warnings) io.stderr(`warning: ${warning}
`);
  if (report.repoCreated) io.stdout("initialized git repo\n");
  if (report.remoteAdded) io.stdout(`added remote origin
next: ${report.next}
`);
}
async function importExistingSkills(home, io, deps) {
  const ports = { link: nodeLinkPort(), now: deps.now };
  const common = { homedir: deps.homedir, scanAgents: true };
  const preview = await runMigrate(ports, home, { ...common, role: "default", apply: false });
  const importable = preview.items.filter((item) => item.disposition === "absorb");
  if (importable.length === 0) return 0;
  const sample = importable.slice(0, 6).map((item) => item.skill).join(", ");
  const more = importable.length > 6 ? `, \u2026 (+${importable.length - 6})` : "";
  io.stdout(`found ${importable.length} existing skill(s) outside neo: ${sample}${more}
`);
  const confirm2 = deps.confirm ?? promptConfirm;
  const answer = await confirm2("import existing skills into a neo role?", true);
  if (!answer) {
    io.stdout("left untouched; import later with: neo migrate --scan-agents\n");
    return 0;
  }
  const role = await resolveRoleTarget(io, deps, void 0, "import", true);
  const report = await runMigrate(ports, home, {
    ...common,
    role,
    strategy: "first",
    apply: true
  });
  const imported = report.items.filter((item) => item.disposition === "absorb").length;
  const failed = report.items.filter((item) => item.disposition === "error");
  io.stdout(`imported ${imported} skill(s) into role ${role}
`);
  if (report.quarantineDir !== null) {
    io.stdout(`duplicate/conflicting copies preserved in ${report.quarantineDir}
`);
  }
  for (const item of failed) io.stderr(`import ${item.skill}: ${item.error ?? "failed"}
`);
  if (failed.length > 0) {
    io.stderr(`import incomplete; retry with: neo migrate --scan-agents --apply --role ${role}
`);
    return 1;
  }
  if (role !== "default") {
    io.stdout(`hint: role "${role}" is not the default; launch with: neo run <agent> --role ${role}
`);
  }
  return 0;
}
var NEW_ROLE_CHOICE = "__new_role__";
async function resolveRoleTarget(io, deps, roleFlag, action, allowCreate) {
  const home = resolveHome(deps);
  if (roleFlag !== void 0) {
    validateRoleName(roleFlag);
    if (roleFlag !== "default" && !await pathExists(roleDir(home, roleFlag))) {
      throw new NeoError(
        "state",
        `${action}: role "${roleFlag}" does not exist (create it first: neo create ${roleFlag})`
      );
    }
    return roleFlag;
  }
  if (!interactiveTty(deps)) {
    const names = (await listRoles(home, null)).map((role) => role.name);
    const known = names.includes("default") ? names : ["default", ...names];
    throw new NeoError(
      "usage",
      `${action}: --role is required (roles: ${known.join(", ")}); "default" is inherited by every role \u2014 pass --role default to opt in`
    );
  }
  const prompts = deps.prompts ?? defaultPromptPort;
  const { config } = await readConfig(home);
  const askTarget = action === "remove" ? `${action}: which role to remove from?` : `${action}: which role to install into?`;
  const warnDefault = action === "remove" ? "default is inherited by every role \u2014 removing there affects every role. Proceed?" : "default is inherited by every role \u2014 install there?";
  for (; ; ) {
    const roles = await listRoles(home, config.activeRole);
    const listed = roles.some((role) => role.name === "default") ? roles : [{ name: "default", skills: 0, active: config.activeRole === null }, ...roles];
    const options = listed.map((role) => ({
      value: role.name,
      label: role.name,
      hint: [
        `${role.skills} skill(s)`,
        role.active ? "active" : null,
        role.name === "default" ? "inherited by every role" : null
      ].filter((part) => part !== null).join(", ")
    }));
    if (allowCreate) options.push({ value: NEW_ROLE_CHOICE, label: "Create a new role\u2026" });
    const chosen = await prompts.select(askTarget, options);
    if (chosen === NEW_ROLE_CHOICE) {
      const name = (await prompts.text({
        message: "New role name",
        validate: (value) => {
          const trimmed = value.trim();
          if (trimmed === "default") return "default always exists \u2014 pick it from the list";
          try {
            validateRoleName(trimmed);
          } catch (error) {
            return error.message;
          }
          return void 0;
        }
      })).trim();
      if (!await pathExists(roleDir(home, name))) {
        await createRole(home, name);
        io.stdout(`created role ${name}
`);
      }
      return name;
    }
    if (chosen === "default") {
      const agreed = await prompts.confirm(warnDefault, false);
      if (agreed) return "default";
      continue;
    }
    return chosen;
  }
}
async function cmdAdd(args, io, deps) {
  const parsed = parseArgs(args, {
    valued: /* @__PURE__ */ new Set(["s", "skill", "role", "domain"]),
    boolean: boolFlags("l")
  });
  const source = expectSinglePositional(parsed, "add <source> --role <name> | --domain <name>");
  const listRequested = parsed.bools.has("l");
  const roleFlag = lastFlag(parsed, "role");
  const domainFlag = lastFlag(parsed, "domain");
  if (roleFlag !== void 0 && domainFlag !== void 0) {
    throw new NeoError("usage", "add: --role and --domain are mutually exclusive (target either a role or a library domain)");
  }
  let skills = [...parsed.flags.get("s") ?? [], ...parsed.flags.get("skill") ?? []].flatMap((value) => value.split(",")).map((s) => s.trim()).filter((s) => s.length > 0);
  if (skills.length > 0 && listRequested) {
    throw new NeoError("usage", "add: -l cannot be combined with --skill/-s");
  }
  if (skills.includes("*") && skills.length > 1) {
    throw new NeoError("usage", 'add: "*" must be used alone (it means all skills)');
  }
  const home = resolveHome(deps);
  const { config } = await readConfig(home);
  const ports = {
    exec: deps.exec,
    ...deps.stagingRoot !== void 0 ? { stagingRoot: deps.stagingRoot } : {},
    now: deps.now
  };
  if (listRequested) {
    const result = await listSourceSkills(ports, { source, skillsRef: config.skillsRef });
    io.stdout(result.stdout);
    if (result.stderr) io.stderr(result.stderr);
    return result.code === 0 ? 0 : 1;
  }
  const role = domainFlag !== void 0 ? void 0 : await resolveRoleTarget(io, deps, roleFlag, "add", true);
  if (skills.length === 0) {
    const isTty = interactiveTty(deps);
    if (!isTty) {
      throw new NeoError(
        "usage",
        'add: --skill/-s is required when not running in an interactive terminal (or use -l to list, or -s "*" to install all)'
      );
    }
    const result = await listSourceSkills(ports, { source, skillsRef: config.skillsRef });
    if (result.stderr) io.stderr(result.stderr);
    if (result.code !== 0) {
      if (result.stdout.trim().length > 0) io.stdout(result.stdout);
      throw new NeoError("failure", `add: could not list source skills (upstream exit ${result.code})`);
    }
    const options = parseSourceSkillList(result.stdout);
    if (options.length === 0) {
      io.stdout(result.stdout);
      throw new NeoError(
        "failure",
        "add: could not parse the source skill list (the raw upstream list is above); install with --skill <name>, or inspect again with -l"
      );
    }
    const only = options[0]?.name;
    if (options.length === 1 && only !== void 0) {
      skills = [only];
    } else {
      const installed = role !== void 0 ? Object.keys((await readRoleLock(home, role))?.skills ?? {}) : await listDomainSkillNames(home, domainFlag);
      const select2 = deps.selectSkills ?? promptSkillSelection;
      const picked = await select2(options, { role: domainFlag ?? role, installed });
      if (picked.length === 0) {
        io.stdout("nothing selected; no skills installed\n");
        return 0;
      }
      skills = picked.includes(SELECT_ALL) ? [SELECT_ALL] : picked;
    }
  }
  const selection = skills.length === 1 && skills[0] === "*" ? { kind: "all" } : { kind: "list", names: skills };
  const report = domainFlag !== void 0 ? await addSourceToDomain(ports, home, {
    source,
    skills: selection,
    domain: domainFlag,
    skillsRef: config.skillsRef
  }) : await addSource(ports, home, {
    source,
    skills: selection,
    role,
    skillsRef: config.skillsRef
  });
  const where = domainFlag !== void 0 ? `into domain ${domainFlag}` : `into role ${role}`;
  for (const skill of report.installed) {
    const verb = skill.replaced ? "replaced" : "installed";
    io.stdout(`${verb} ${skill.name} (hash ${skill.hash}) ${where}
`);
  }
  if (report.upstreamError) io.stderr(`${report.upstreamError}
`);
  for (const failure of report.failed) {
    io.stderr(`failed ${failure.name}: ${failure.error}
`);
  }
  if (report.installed.length + report.failed.length > 0) {
    io.stdout(`${report.installed.length} installed, ${report.failed.length} failed
`);
  }
  return report.failed.length === 0 && !report.upstreamError ? 0 : 1;
}
async function listDomainSkillNames(home, domain) {
  try {
    return await fs28.readdir(path26.join(libraryDir(home), domain));
  } catch {
    return [];
  }
}
async function cmdCreate(args, io, deps) {
  const parsed = parseArgs(args, { valued: /* @__PURE__ */ new Set(), boolean: boolFlags() });
  const name = expectSinglePositional(parsed, "create <name>");
  const home = resolveHome(deps);
  await createRole(home, name);
  io.stdout(
    `created role ${name}
next: make it the default with "neo use ${name}", or launch with "neo run <agent> --role ${name}"
`
  );
  return 0;
}
async function cmdRole(args, io, deps) {
  const cleaned = args.filter((arg) => arg !== "--yes");
  const sub = cleaned[0];
  if (sub !== "set") {
    throw new NeoError(
      "usage",
      `role: subcommand required (expected "set": neo role set <role> [--agents-md <file>|'-'] [--domains a,b] [--mcp <file>|'-'] [--dry-run] [--json])`
    );
  }
  return cmdRoleSet(cleaned.slice(1), io, deps);
}
function absorbStdinDash(args) {
  const out = [];
  for (let i2 = 0; i2 < args.length; i2++) {
    const arg = args[i2];
    if ((arg === "--agents-md" || arg === "--mcp") && args[i2 + 1] === "-") {
      out.push(`${arg}=-`);
      i2++;
      continue;
    }
    out.push(arg);
  }
  return out;
}
async function readStdinAll() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
async function cmdRoleSet(args, io, deps) {
  const parsed = parseArgs(absorbStdinDash(args), {
    valued: /* @__PURE__ */ new Set(["agents-md", "domains", "mcp"]),
    boolean: boolFlags("dry-run", "json")
  });
  const role = expectSinglePositional(parsed, "role set <role> [--agents-md <file>|'-'] [--domains a,b] [--mcp <file>|'-']");
  const agentsMdFlag = lastFlag(parsed, "agents-md");
  const mcpFlag = lastFlag(parsed, "mcp");
  const domainsFlag = parsed.flags.has("domains") ? lastFlag(parsed, "domains") : void 0;
  if (agentsMdFlag === void 0 && mcpFlag === void 0 && domainsFlag === void 0) {
    throw new NeoError(
      "usage",
      "role set: at least one of --agents-md, --domains, --mcp is required (see: neo role set --help)"
    );
  }
  const cwd = deps.cwd ?? process.cwd();
  const readInputText = async (value, flag) => {
    if (value === "-") return (deps.readStdin ?? readStdinAll)();
    try {
      return await fs28.readFile(path26.resolve(cwd, value), "utf8");
    } catch (error) {
      throw new NeoError(
        "failure",
        `role set: cannot read ${flag} file ${JSON.stringify(value)}: ${error.message}`
      );
    }
  };
  const input = { role };
  if (agentsMdFlag !== void 0) input.agentsMd = await readInputText(agentsMdFlag, "--agents-md");
  if (mcpFlag !== void 0) input.mcp = await readInputText(mcpFlag, "--mcp");
  if (domainsFlag !== void 0) {
    input.domains = domainsFlag.split(",").map((domain) => domain.trim()).filter((domain) => domain.length > 0);
  }
  if (parsed.bools.has("dry-run")) input.dryRun = true;
  const result = await setRoleAssembly(resolveHome(deps), input);
  if (parsed.bools.has("json")) {
    io.stdout(
      `${JSON.stringify(
        {
          ok: true,
          role: result.role,
          dryRun: result.dryRun,
          changed: Object.entries(result.changed).filter(([, on]) => on).map(([key]) => key === "agentsMd" ? "agents-md" : key),
          dirty: result.dirty,
          files: result.files
        },
        null,
        2
      )}
`
    );
    return 0;
  }
  const headline = `role set ${result.role}${result.dryRun ? " (dry-run)" : ""}`;
  if (result.files.every((file) => file.change === "unchanged")) {
    io.stdout(`${headline}: no change
`);
    return 0;
  }
  io.stdout(`${headline}:
`);
  for (const file of result.files) {
    io.stdout(`  ${file.change} ${file.file}
`);
    if (result.dryRun && file.diff.length > 0) io.stdout(file.diff);
  }
  if (result.dryRun) {
    io.stdout(`dry-run: nothing written${result.dirty ? " (lock would be marked dirty)" : ""}
`);
  } else if (result.dirty) {
    io.stdout('lock marked dirty: run "neo update" or re-converge ("neo use <role> --global") to clear\n');
  }
  return 0;
}
async function cmdList(args, io, deps) {
  const parsed = parseArgs(args, { valued: /* @__PURE__ */ new Set(["role"]), boolean: boolFlags("json") });
  const sub = parsed.positionals[0] ?? "roles";
  if (sub !== "roles" && sub !== "skills" && sub !== "domains" && sub !== "agents") {
    throw new NeoError("usage", `list: unknown subcommand "${sub}" (expected roles|skills|domains|agents)`);
  }
  if (parsed.positionals.length > 1) throw new NeoError("usage", "list: too many arguments");
  const roleFlag = lastFlag(parsed, "role");
  if (roleFlag !== void 0 && sub !== "skills") {
    throw new NeoError("usage", `list ${sub}: --role filter applies to "list skills" only`);
  }
  const home = resolveHome(deps);
  const { config } = await readConfig(home);
  if (sub === "roles") {
    const roles = await listRoles(home, config.activeRole);
    if (parsed.bools.has("json")) {
      io.stdout(`${JSON.stringify({ activeRole: config.activeRole, roles }, null, 2)}
`);
    } else {
      for (const role of roles) {
        io.stdout(`${role.active ? "*" : " "} ${role.name} (${role.skills} skills)
`);
      }
    }
    return 0;
  }
  if (sub === "domains") {
    const domains = await listDomains(home);
    if (parsed.bools.has("json")) {
      io.stdout(`${JSON.stringify({ domains }, null, 2)}
`);
    } else {
      for (const domain of domains) {
        io.stdout(`  ${domain.name} (${domain.skills} skills)
`);
      }
    }
    return 0;
  }
  if (sub === "agents") {
    const registry = await readRegistry(home);
    const port = deps.detect ?? nodeDetectPort();
    const detections = new Map(
      (await detectAgents(registry, deps.homedir, port)).map((detection) => [detection.id, detection.signals])
    );
    const view = registry.map((entry) => {
      const configured = config.targets.find((target) => target.agent === entry.id);
      return {
        entry,
        configured: configured !== void 0,
        agentsMdOptIn: configured?.agentsMd === true,
        detected: detections.get(entry.id) ?? []
      };
    });
    if (parsed.bools.has("json")) {
      io.stdout(
        `${JSON.stringify(
          {
            agents: view.map((row) => ({
              id: row.entry.id,
              skillsDir: row.entry.skillsDir,
              ...row.entry.skillsDirProject !== void 0 ? { skillsDirProject: row.entry.skillsDirProject } : {},
              ...row.entry.agentsMd !== void 0 ? { agentsMd: row.entry.agentsMd } : {},
              configured: row.configured,
              agentsMdOptIn: row.agentsMdOptIn,
              detected: row.detected
            }))
          },
          null,
          2
        )}
`
      );
      return 0;
    }
    if (view.some((row) => row.configured)) {
      io.stdout("* = configured as legacy global mount (neo use --global); detection is advisory\n");
    }
    for (const row of view) {
      const tail = [
        row.entry.skillsDir,
        ...row.agentsMdOptIn ? ["agents-md"] : [],
        row.detected.length > 0 ? `detected: ${row.detected.join(", ")}` : "(not detected)"
      ];
      io.stdout(`${row.configured ? "*" : " "} ${row.entry.id}  ${tail.join("  ")}
`);
    }
    return 0;
  }
  const groups = await listSkills(home, roleFlag);
  if (parsed.bools.has("json")) {
    io.stdout(`${JSON.stringify({ groups }, null, 2)}
`);
  } else {
    for (const group of groups) {
      io.stdout(`${group.role}:
`);
      for (const skill of group.skills) io.stdout(`  ${skill}
`);
      if (group.skills.length === 0) io.stdout("  (no skills)\n");
    }
  }
  return 0;
}
async function cmdTarget(args, io, deps) {
  const home = resolveHome(deps);
  const cleaned = args.filter((arg) => arg !== "--yes");
  const sub = cleaned[0];
  if (sub !== void 0 && sub.startsWith("-")) {
    throw new NeoError("usage", `target: unknown option "${sub}" (subcommands: add, remove)`);
  }
  if (sub === void 0) {
    const targets = await listConfiguredTargets(home, deps.homedir);
    if (targets.length === 0) {
      io.stdout('no targets configured (only needed for "neo use --global"; "neo run" does not use targets)\n');
      return 0;
    }
    for (const target of targets) {
      io.stdout(
        `${target.agent} ${target.skillsDir}${target.agentsMd ? " (agents-md)" : ""}
`
      );
    }
    return 0;
  }
  if (sub === "add") {
    const parsed = parseArgs(cleaned.slice(1), {
      valued: /* @__PURE__ */ new Set(["skills-dir"]),
      boolean: boolFlags("agents-md")
    });
    const id = expectSinglePositional(parsed, "target add <agent-id>");
    const skillsDir = lastFlag(parsed, "skills-dir");
    const resolved = await addTarget(home, deps.homedir, id, {
      ...skillsDir !== void 0 ? { skillsDir } : {},
      agentsMd: parsed.bools.has("agents-md")
    });
    io.stdout(`added target ${resolved.agent} -> ${resolved.skillsDir}
`);
    return 0;
  }
  if (sub === "remove") {
    const parsed = parseArgs(cleaned.slice(1), { valued: /* @__PURE__ */ new Set(), boolean: boolFlags() });
    const id = expectSinglePositional(parsed, "target remove <agent-id>");
    const result = await removeTarget(home, deps.homedir, id);
    io.stdout(`removed target ${id}
`);
    if (result.stillRecorded) {
      io.stderr(
        `warning: state/mounts.json still records ${id}${result.dir ? ` (${result.dir})` : ""}; run: neo off before removing, or keep the links (re-adding ${id} restores them)
`
      );
    }
    return 0;
  }
  throw new NeoError("usage", `target: unknown subcommand "${sub}" (expected add|remove)`);
}
async function cmdUse(args, io, deps) {
  const parsed = parseArgs(args, {
    valued: /* @__PURE__ */ new Set(),
    boolean: boolFlags("force", "project", "link", "global")
  });
  if (parsed.positionals.length > 1) throw new NeoError("usage", "use: too many arguments");
  const role = parsed.positionals[0];
  const cwd = deps.cwd ?? process.cwd();
  const global = parsed.bools.has("global");
  if (parsed.bools.has("link") && !parsed.bools.has("project")) {
    throw new NeoError("usage", "use: --link applies to --project bindings only");
  }
  if (parsed.bools.has("project")) {
    if (role === void 0) throw new NeoError("usage", "use --project: <role> is required");
    if (global) throw new NeoError("usage", "use: --global and --project are mutually exclusive");
    if (parsed.bools.has("force")) {
      throw new NeoError("usage", "use: --force applies to the global mount layer only");
    }
    const report = await useProject({ link: nodeLinkPort() }, resolveHome(deps), deps.homedir, {
      cwd,
      role,
      link: parsed.bools.has("link")
    });
    const state = report.created ? " (new binding)" : report.alreadyBound ? " (already bound)" : "";
    io.stdout(`bound role ${report.role}${state} -> ${report.file}
`);
    if (report.modeChanged !== null) io.stdout(`materialize mode -> ${report.modeChanged}
`);
    return printProjectSyncReport(io, report.sync);
  }
  if (global) {
    const report = await useRole({ link: nodeLinkPort() }, resolveHome(deps), {
      homedir: deps.homedir,
      ...role !== void 0 ? { role } : {},
      force: parsed.bools.has("force")
    });
    return printConvergeReport(io, report);
  }
  if (parsed.bools.has("force")) {
    throw new NeoError("usage", "use: --force applies to --global only");
  }
  const home = resolveHome(deps);
  if (role === void 0) {
    const { config } = await readConfig(home);
    if (config.activeRole === null) {
      throw new NeoError("state", "no default role (config.activeRole is null); run: neo use <role>");
    }
    io.stdout(`default role: ${config.activeRole}
launch with: neo run <agent>
`);
    return 0;
  }
  validateRoleName(role);
  if (role !== "default" && !await pathExists(roleDir(home, role))) {
    throw new NeoError("state", `role "${role}" not found`);
  }
  await setActiveRole(home, role);
  const bound = await discoverProjectManifest(cwd);
  if (bound !== null) {
    io.stderr(
      `hint: inside a project binding (${bound.file}); "neo run" uses the binding role unless --role --force is given
`
    );
  }
  io.stdout(
    `default role set: ${role}
launch with: neo run <agent> [--role ${role}]
(global agent dirs untouched; run: neo use ${role} --global to mount)
`
  );
  return 0;
}
async function resolveRunAgent(parsed, registry, deps, homedir) {
  if (parsed.positionals.length > 1) {
    throw new NeoError("usage", "run: too many arguments (expected one agent id)");
  }
  const raw = parsed.positionals[0];
  if (raw !== void 0) return raw;
  const launchable = registry.filter((entry) => entry.isolate?.supports.includes("launch")).sort((a2, b) => a2.id.localeCompare(b.id));
  if (launchable.length === 0) {
    throw new NeoError("state", "run: no registered agent supports launch; extend the registry (agents.yaml) first");
  }
  if (!interactiveTty(deps)) {
    throw new NeoError(
      "usage",
      `run: <agent> is required (neo run launches: ${launchable.map((entry) => entry.id).join(", ")}; see: neo list agents)`
    );
  }
  const detections = new Map(
    (await detectAgents(registry, homedir, deps.detect ?? nodeDetectPort())).map((detection) => [
      detection.id,
      detection.signals
    ])
  );
  const prompts = deps.prompts ?? defaultPromptPort;
  return prompts.select(
    "run: which agent to launch?",
    launchable.map((entry) => ({
      value: entry.id,
      label: entry.id,
      hint: (detections.get(entry.id)?.length ?? 0) > 0 ? "detected on this machine" : "not detected (install it first)"
    }))
  );
}
async function cmdRun(args, io, deps) {
  const sep = args.indexOf("--");
  const head = sep === -1 ? args : args.slice(0, sep);
  const agentArgs = sep === -1 ? [] : args.slice(sep + 1);
  const parsed = parseArgs(head, {
    valued: /* @__PURE__ */ new Set(["role"]),
    boolean: boolFlags("isolated", "ephemeral", "force", "headless", "acp", "agent-models")
  });
  const home = resolveHome(deps);
  const agent = await resolveRunAgent(parsed, await readRegistry(home), deps, deps.homedir);
  if (parsed.bools.has("headless") && parsed.bools.has("acp")) {
    throw new NeoError("usage", "run: --headless and --acp are mutually exclusive");
  }
  if ((parsed.bools.has("headless") || parsed.bools.has("acp")) && agent !== "dsh") {
    throw new NeoError("usage", "run: --headless / --acp apply to the dsh agent only");
  }
  const cwd = deps.cwd ?? process.cwd();
  let role = lastFlag(parsed, "role");
  const bound = await discoverProjectManifest(cwd);
  if (bound !== null) {
    const loaded = await readProjectManifest(bound.root);
    const bindingRoles = loaded?.manifest.roles ?? [];
    const bindingRole = bindingRoles.length > 0 ? bindingRoles[bindingRoles.length - 1] : void 0;
    if (role === void 0) {
      role = bindingRole ?? "default";
    } else if (bindingRole !== void 0 && role !== bindingRole) {
      if (!parsed.bools.has("force")) {
        throw new NeoError(
          "state",
          `project binding uses role "${bindingRole}"; pass --force to launch "${role}" (materialized project skills stay visible)`
        );
      }
      io.stderr(`warning: launching "${role}" inside a binding for "${bindingRole}"; project skills remain visible
`);
    }
  } else if (role === void 0) {
    const { config } = await readConfig(home);
    role = config.activeRole ?? "default";
  }
  role = role ?? "default";
  validateRoleName(role);
  const profile = parsed.bools.has("headless") ? "headless" : parsed.bools.has("acp") ? "acp" : void 0;
  const plan = await planLaunch({ link: nodeLinkPort(), now: deps.now }, home, deps.homedir, {
    agent,
    role,
    isolated: parsed.bools.has("isolated"),
    ephemeral: parsed.bools.has("ephemeral"),
    args: agentArgs,
    ...profile !== void 0 ? { dshProfile: profile } : {},
    env: deps.env,
    cwd,
    useAgentModels: parsed.bools.has("agent-models")
  });
  io.stderr(
    `neo run: role=${role} agent=${agent} root=${plan.root}${plan.isolated ? " (isolated)" : ""}${plan.report.models.file === null && plan.report.models.providers === 0 ? " (no neo model config: the agent starts with its own)" : ""}
`
  );
  try {
    return await (deps.spawnAgent ?? spawnAgentNode)(plan);
  } finally {
    await disposeLaunch(plan);
  }
}
async function spawnAgentNode(plan) {
  const env = { ...process.env, ...plan.env };
  const resolved = isWindowsShim(plan.command) ? await resolveShimTarget(plan.command) : null;
  if (resolved !== null) {
    return runChild(resolved.command, [...resolved.args, ...plan.args], plan, env);
  }
  if (isWindowsShim(plan.command)) {
    const line = [escapeCmdArgument(plan.command), ...plan.args.map((arg) => escapeCmdArgument(arg))].join(" ");
    return runChild(
      process.env.ComSpec ?? "cmd.exe",
      ["/d", "/s", "/c", `"${line}"`],
      plan,
      env,
      { windowsVerbatimArguments: true }
    );
  }
  return runChild(plan.command, [...plan.args], plan, env);
}
function runChild(command, args, plan, env, extra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn2(command, [...args], {
      cwd: plan.cwd,
      env,
      stdio: "inherit",
      ...extra
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
var isWindowsShim = (command) => process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
async function resolveShimTarget(shim) {
  let text2;
  try {
    text2 = await fs28.readFile(shim, "utf8");
  } catch {
    return null;
  }
  const match = /%dp0%[\\/](node_modules[\\/][^"%\r\n]+?\.(?:js|exe))/i.exec(text2);
  const relative = match?.[1];
  if (relative === void 0) return null;
  const target = path26.join(path26.dirname(shim), relative);
  try {
    const stat = await fs28.stat(target);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }
  return target.toLowerCase().endsWith(".js") ? { command: process.execPath, args: [target] } : { command: target, args: [] };
}
var CMD_META_CHARS = /([()\\][%!^"`<>&|;, *?])/g;
function escapeCmdArgument(arg) {
  let value = `${arg}`;
  value = value.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  value = value.replace(/(?=(\\+?)?)\1$/, "$1$1");
  value = `"${value}"`;
  return value.replace(CMD_META_CHARS, "^$1");
}
async function cmdRoots(args, io, deps) {
  const parsed = parseArgs(args, { valued: /* @__PURE__ */ new Set(), boolean: boolFlags("clean") });
  const home = resolveHome(deps);
  if (parsed.bools.has("clean")) {
    const role = expectSinglePositional(parsed, "roots --clean <role>");
    validateRoleName(role);
    const removed = await cleanRoleRoots(home, role);
    if (removed.length === 0) {
      io.stdout(`no launch roots for role "${role}"
`);
      return 0;
    }
    for (const dir of removed) io.stdout(`removed ${dir}
`);
    return 0;
  }
  if (parsed.positionals.length > 0) throw new NeoError("usage", "roots: takes no positional arguments");
  const roots = await listRoots(home);
  if (roots.length === 0) {
    io.stdout("no launch roots yet (launch with: neo run <agent>)\n");
    return 0;
  }
  for (const root of roots) {
    const flags = [root.meta ? "managed" : "unmarked", root.roleExists ? null : "orphan"].filter((flag) => flag !== null).join(", ");
    io.stdout(`${root.role} ${root.agent} ${root.dir} (${flags})
`);
  }
  return 0;
}
async function cmdMaterialize(args, io, deps) {
  const parsed = parseArgs(args, {
    valued: /* @__PURE__ */ new Set(["role", "agent", "out"]),
    boolean: boolFlags("json", "no-auth", "agent-models")
  });
  if (parsed.positionals.length > 0) {
    throw new NeoError("usage", "materialize: takes no positional arguments");
  }
  const role = lastFlag(parsed, "role");
  const agent = lastFlag(parsed, "agent");
  const out = lastFlag(parsed, "out");
  if (role === void 0) throw new NeoError("usage", "materialize: --role <name> is required");
  if (agent === void 0) {
    throw new NeoError(
      "usage",
      `materialize: --agent <agent-id> is required (neo materialize launches: ${(await launchableIds(deps)).join(", ")})`
    );
  }
  if (out === void 0 || out.trim().length === 0) {
    throw new NeoError("usage", "materialize: --out <dir> is required");
  }
  const cwd = deps.cwd ?? process.cwd();
  const { manifest } = await materializeRoot(
    { link: nodeLinkPort(), now: deps.now },
    resolveHome(deps),
    deps.homedir,
    {
      role,
      agent,
      out: path26.resolve(cwd, out),
      env: deps.env,
      ...parsed.bools.has("agent-models") ? { skipModels: true } : {},
      ...parsed.bools.has("no-auth") ? { noAuth: true } : {}
    }
  );
  if (parsed.bools.has("json")) {
    io.stdout(`${JSON.stringify(manifest, null, 2)}
`);
    return 0;
  }
  io.stdout(`materialized role=${role} agent=${agent}: ${manifest.outDir}
`);
  io.stdout(`  skills: ${manifest.skills.map((s) => `${s.name} (${s.source})`).join(", ") || "none"}
`);
  io.stdout(
    `  mcp: ${manifest.mcp.servers} server(s)${manifest.mcp.file === null ? "" : ` -> ${manifest.mcp.file}`}${Object.keys(manifest.mcp.envRefs).length > 0 ? ` (env refs: ${Object.keys(manifest.mcp.envRefs).join(", ")})` : ""}
`
  );
  io.stdout(
    `  model: ${manifest.model.file === null ? `none${manifest.model.reason !== void 0 ? ` (${manifest.model.reason})` : ""}` : `${manifest.model.default ?? "custom"} -> ${manifest.model.file}`}
`
  );
  if (manifest.authExcluded) {
    io.stdout("  auth: excluded (--no-auth; credential-free export, authExcluded=true)\n");
  }
  io.stdout("  (resources only: neo materialize never launches a process)\n");
  return 0;
}
async function cmdOff(args, io, deps) {
  const parsed = parseArgs(args, {
    valued: /* @__PURE__ */ new Set(["role"]),
    boolean: boolFlags("project", "global")
  });
  if (parsed.positionals.length > 0) throw new NeoError("usage", "off: takes no positional arguments");
  if (parsed.bools.has("project")) {
    if (parsed.bools.has("global")) {
      throw new NeoError("usage", "off: --global and --project are mutually exclusive");
    }
    const roles = parsed.flags.get("role") ?? [];
    const report = await offProject({ link: nodeLinkPort() }, resolveHome(deps), deps.homedir, {
      cwd: deps.cwd ?? process.cwd(),
      ...roles.length > 0 ? { roles } : {}
    });
    const scope = report.cleared ? `unbound all roles (manifest removed) -> ${report.file}` : `unbound role ${report.removedRoles.join(", ")} -> ${report.file}`;
    io.stdout(`${scope}
`);
    return printProjectSyncReport(io, report.sync);
  }
  if ((parsed.flags.get("role") ?? []).length > 0) {
    throw new NeoError("usage", "off: --role applies to --project only");
  }
  if (parsed.bools.has("global")) {
    const report = await offAll({ link: nodeLinkPort() }, resolveHome(deps), {
      homedir: deps.homedir
    });
    return printConvergeReport(io, report);
  }
  await setActiveRole(resolveHome(deps), null);
  io.stdout("default role cleared (global mounts, if any, untouched; run: neo off --global)\n");
  return 0;
}
async function cmdSync(args, io, deps) {
  const parsed = parseArgs(args, { valued: /* @__PURE__ */ new Set(), boolean: boolFlags("apply", "force", "json") });
  if (parsed.positionals.length > 0) throw new NeoError("usage", "sync: takes no positional arguments");
  const cwd = deps.cwd ?? process.cwd();
  const found = await discoverProjectManifest(cwd);
  if (found === null) {
    throw new NeoError(
      "state",
      "no project manifest found (cwd up-search): project not bound (run: neo use <role> --project to bind)"
    );
  }
  const report = await syncProject({ link: nodeLinkPort() }, resolveHome(deps), deps.homedir, {
    root: found.root,
    apply: parsed.bools.has("apply"),
    force: parsed.bools.has("force")
  });
  if (parsed.bools.has("json")) {
    io.stdout(`${JSON.stringify(report, null, 2)}
`);
    return report.apply ? report.ok ? 0 : 1 : 0;
  }
  return printProjectSyncReport(io, report);
}
function printProjectSyncReport(io, report) {
  const headline = report.apply ? "apply" : "preview (execute with --apply)";
  io.stdout(`sync ${headline}: ${report.root} [${report.roles.join(", ")}]
`);
  for (const item of report.items) {
    const from = item.sourceRole !== void 0 ? ` (from ${item.sourceRole})` : "";
    const detail = item.detail !== void 0 ? `: ${item.detail}` : "";
    io.stdout(`  ${item.status} ${item.skill} -> ${item.action}${from}${detail}
`);
  }
  for (const action of report.agentsMd) {
    const note = action.note !== void 0 ? ` [${action.note}]` : "";
    io.stdout(`  agents-md ${action.kind} ${action.file}${note}
`);
  }
  for (const warning of report.warnings) io.stderr(`warning: ${warning}
`);
  for (const note of report.notes) io.stdout(`${note}
`);
  return report.apply ? report.ok ? 0 : 1 : 0;
}
function printConvergeReport(io, report) {
  const headline = report.role === null ? "off" : `use ${report.role}`;
  if (report.targets.length === 0) {
    io.stdout(`${headline}: no targets configured (targets are only used by "neo use --global")
`);
    return 0;
  }
  for (const target of report.targets) {
    io.stdout(`${target.agent} ${target.dir}
`);
    for (const action of target.actions) {
      const from = action.sourceRole !== void 0 ? ` (from ${action.sourceRole})` : "";
      const note = action.note !== void 0 ? ` [${action.note}]` : "";
      io.stdout(`  ${action.kind} ${action.skill}${from}${note}
`);
    }
    for (const action of target.agentsMd) {
      const note = action.note !== void 0 ? ` [${action.note}]` : "";
      io.stdout(`  agents-md ${action.kind} ${action.file}${note}
`);
    }
    for (const conflict of target.conflicts) {
      io.stdout(`  conflict ${conflict.skill}: ${conflict.detail}
`);
    }
    for (const error of target.errors) {
      io.stdout(`  error ${error.skill}: ${error.error}
`);
    }
    for (const warning of target.warnings) {
      io.stderr(`warning: ${warning}
`);
    }
  }
  return report.ok ? 0 : 1;
}
async function cmdMigrate(args, io, deps) {
  const parsed = parseArgs(args, {
    valued: /* @__PURE__ */ new Set(["strategy", "role"]),
    boolean: boolFlags("apply", "scan-agents", "absorb-links", "json")
  });
  if (parsed.positionals.length > 0) throw new NeoError("usage", "migrate: takes no positional arguments");
  const strategy = lastFlag(parsed, "strategy");
  if (strategy !== void 0 && !MIGRATE_STRATEGIES.includes(strategy)) {
    throw new NeoError(
      "usage",
      `migrate: unknown strategy "${strategy}" (expected ${MIGRATE_STRATEGIES.join("|")})`
    );
  }
  const roleFlag = lastFlag(parsed, "role");
  const role = parsed.bools.has("apply") ? await resolveRoleTarget(io, deps, roleFlag, "migrate", true) : roleFlag;
  const report = await runMigrate({ link: nodeLinkPort(), now: deps.now }, resolveHome(deps), {
    homedir: deps.homedir,
    ...role !== void 0 ? { role } : {},
    ...strategy !== void 0 ? { strategy } : {},
    scanAgents: parsed.bools.has("scan-agents"),
    absorbLinks: parsed.bools.has("absorb-links"),
    apply: parsed.bools.has("apply")
  });
  if (parsed.bools.has("json")) {
    io.stdout(`${JSON.stringify(report, null, 2)}
`);
  } else {
    printMigrateReport(io, report);
  }
  return report.apply ? report.ok ? 0 : 1 : 0;
}
function printMigrateReport(io, report) {
  io.stdout(
    `migrate ${report.apply ? "apply" : "preview (execute with --apply)"}: role ${report.role}, strategy ${report.strategy}
`
  );
  io.stdout(
    report.v3Lock.present ? `v3 lock: ${report.v3Lock.path} (${report.v3Lock.entries} entries)
` : "v3 lock: not found (scenario A skipped)\n"
  );
  if (report.v3Lock.warning !== void 0) io.stderr(`${report.v3Lock.warning}
`);
  for (const scan of report.scannedDirs) {
    io.stdout(`scanned ${scan.dir}${scan.agent !== null ? ` (${scan.agent})` : ""}
`);
  }
  const hashTag = (hash) => hash !== void 0 ? ` ${hash.slice(0, 8)}\u2026` : "";
  for (const item of report.items) {
    switch (item.disposition) {
      case "absorb": {
        const dest = roleSkillsDir(report.home, report.role);
        io.stdout(`  absorb ${item.skill}:${hashTag(item.winner?.hash)} ${item.winner?.origin ?? ""} -> ${path26.join(dest, item.skill)}
`);
        for (const loser of item.losers ?? []) {
          io.stdout(`    quarantine ${loser.origin}${hashTag(loser.hash)} -> ${report.quarantineDir ?? "(none)"}
`);
        }
        break;
      }
      case "conflict": {
        io.stdout(`  conflict ${item.skill} (strategy skip): not touched
`);
        for (const side of item.conflictSides ?? []) {
          io.stdout(`    side ${side.origin}${hashTag(side.hash)}
`);
        }
        break;
      }
      case "error":
        io.stdout(`  error ${item.skill}: ${item.error ?? ""}
`);
        break;
      default:
        io.stdout(`  ${item.disposition} ${item.skill}${item.detail !== void 0 ? `: ${item.detail}` : ""}
`);
    }
  }
  for (const link of report.linksNoticed) io.stdout(`${link.note}
`);
  if (report.quarantineDir !== null) io.stdout(`quarantine dir: ${report.quarantineDir}
`);
  for (const note of report.notes) io.stdout(`${note}
`);
}
async function cmdStatus(args, io, deps) {
  const parsed = parseArgs(args, { valued: /* @__PURE__ */ new Set(), boolean: boolFlags("json") });
  if (parsed.positionals.length > 0) throw new NeoError("usage", "status: takes no arguments");
  const json = parsed.bools.has("json");
  try {
    const report = await statusAudit(
      { link: nodeLinkPort() },
      resolveHome(deps),
      { homedir: deps.homedir }
    );
    if (json) {
      io.stdout(
        `${JSON.stringify(
          {
            ...report,
            errors: [
              ...report.errors,
              ...report.findings.map((f) => `[${f.check}] ${f.path}: ${f.detail}`)
            ]
          },
          null,
          2
        )}
`
      );
    } else {
      printStatusReport(io, report);
      if (report.initialized) {
        for (const error of report.errors) io.stderr(`error: ${error}
`);
      }
      for (const warning of report.warnings) io.stderr(`warning: ${warning.detail}
`);
    }
    return report.ok ? 0 : 1;
  } catch (error) {
    if (!(error instanceof NeoError)) throw error;
    if (json) io.stdout(`${JSON.stringify({ ok: false, errors: [error.message] }, null, 2)}
`);
    else io.stderr(`neo: ${error.message}
`);
    return 1;
  }
}
function printStatusReport(io, report) {
  io.stdout(`neo status: ${report.home}
`);
  if (!report.initialized) {
    io.stdout(`${report.errors[0] ?? "neo home not initialized"}
`);
    return;
  }
  io.stdout(`activeRole: ${report.activeRole ?? "null (off)"}
`);
  for (const target of report.targets) {
    io.stdout(`${target.agent} ${target.dir}
`);
    io.stdout(`  skills: ${target.verified}/${target.recorded} recorded slots verified
`);
    io.stdout(`  agents-md: ${target.agentsMd}
`);
    for (const finding of report.findings.filter((f) => f.dir === target.dir)) {
      io.stdout(`  drift [${finding.check}/${finding.kind}] ${finding.path}
`);
      io.stdout(`    ${finding.detail}
`);
    }
  }
  for (const finding of report.findings.filter((f) => f.check === "lock-dirty")) {
    io.stdout(`drift [${finding.check}/${finding.kind}] ${finding.path}
`);
    io.stdout(`    ${finding.detail}
`);
  }
  for (const note of report.notes) io.stdout(`note: ${note}
`);
  for (const role of report.roles.filter((item) => item.domains.length > 0)) {
    io.stdout(`domains: ${role.name} \u2190 [${role.domains.join(", ")}]
`);
  }
  if (report.adjudications.length > 0) {
    io.stdout("same-name adjudication (role > domain > default):\n");
    for (const item of report.adjudications) {
      io.stdout(`  ${item.skill} (role ${item.role}): ${item.winner} wins over ${item.losers.join(", ")}
`);
    }
  }
  if (report.legacyGlobalMounts.length > 0) {
    io.stdout(`legacy global mounts: ${report.legacyGlobalMounts.length}
`);
    for (const item of report.legacyGlobalMounts) {
      const parts = [`${item.skills} slot(s)`];
      if (item.agentsMd) parts.push("agents-md");
      io.stdout(`  ${item.agent} ${item.dir} (${parts.join(", ")})
`);
    }
    io.stdout("  run: neo off --global to unmount (launch mode never writes these dirs)\n");
  }
  if (report.roots.length > 0) {
    io.stdout(`launch roots: ${report.roots.length}
`);
    for (const root of report.roots) {
      io.stdout(`  ${root.role} ${root.agent}${root.roleExists ? "" : " (orphan: role deleted; neo roots --clean <role>)"}
`);
    }
  }
  if (report.launch.length > 0) {
    io.stdout(
      `launch matrix: ${report.launch.map(
        (item) => `${item.agent}(${item.level}${item.models === "none" ? ", no model config" : `, models:${item.models}`})`
      ).join(" ")}
`
    );
  }
  if (report.ok) {
    io.stdout(
      report.warnings.length > 0 ? `ok, with ${report.warnings.length} warning(s) (exit 0)
` : `ok: all six checks passed
`
    );
  } else {
    io.stdout(`${report.findings.length} drift finding(s) (exit 1)
`);
  }
}
async function cmdUpdate(args, io, deps) {
  const parsed = parseArgs(args, { valued: /* @__PURE__ */ new Set(["role"]), boolean: boolFlags("dry-run", "json") });
  if (parsed.positionals.length > 0) throw new NeoError("usage", "update: takes no positional arguments");
  const dryRun = parsed.bools.has("dry-run");
  if (parsed.bools.has("json") && !dryRun) {
    throw new NeoError("usage", "update: --json is only available with --dry-run");
  }
  const roles = parsed.flags.get("role");
  const home = resolveHome(deps);
  const { config } = await readConfig(home);
  const report = await updateRoles(
    {
      exec: deps.exec,
      ...deps.stagingRoot !== void 0 ? { stagingRoot: deps.stagingRoot } : {},
      now: deps.now
    },
    home,
    {
      ...roles !== void 0 && roles.length > 0 ? { roles } : {},
      dryRun,
      skillsRef: config.skillsRef
    }
  );
  if (parsed.bools.has("json")) {
    io.stdout(`${JSON.stringify(report, null, 2)}
`);
    return report.ok ? 0 : 1;
  }
  if (report.roles.length === 0) {
    io.stdout("no locked roles (nothing to update)\n");
  }
  for (const outcome of report.roles) {
    if (outcome.skipped) {
      io.stdout(`${outcome.role}: ${outcome.note ?? "no lock (skipped)"}
`);
      continue;
    }
    if (outcome.error !== void 0) {
      io.stderr(`${outcome.role}: ${outcome.error}
`);
      continue;
    }
    io.stdout(`${outcome.role}:
`);
    for (const source of outcome.sources) {
      if (source.error !== void 0) {
        io.stderr(`${outcome.role}: ${source.source}: ${source.error}
`);
        continue;
      }
      if (dryRun) {
        for (const item of source.items) {
          if (item.state === "unchanged") {
            io.stdout(`  unchanged ${item.name} (${item.newHash})
`);
          } else if (item.state === "update") {
            const note = item.note !== void 0 ? ` [${item.note}]` : "";
            io.stdout(`  update ${item.name} ${item.oldHash} -> ${item.newHash}${note}
`);
          } else if (item.state === "gone-from-source") {
            io.stdout(`  gone-from-source ${item.name} (kept locally)
`);
          } else {
            io.stdout(`  would-install ${item.name} (${item.newHash})
`);
          }
        }
      } else {
        for (const action of outcome.applied) {
          if (action.kind === "updated") {
            io.stdout(`  updated ${action.name} (${action.oldHash} -> ${action.newHash})
`);
          } else {
            io.stdout(`  installed ${action.name} (${action.newHash})
`);
          }
        }
        for (const item of source.items) {
          if (item.state === "gone-from-source") {
            io.stdout(`  gone-from-source ${item.name} (kept locally)
`);
          }
        }
      }
    }
  }
  for (const outcome of report.roles) {
    for (const warning of outcome.warnings) io.stderr(`${outcome.role}: ${warning}
`);
    for (const failure of outcome.failed) io.stderr(`${outcome.role}: failed ${failure.name}: ${failure.error}
`);
  }
  return report.ok ? 0 : 1;
}
async function cmdRemove(args, io, deps) {
  const parsed = parseArgs(args, { valued: /* @__PURE__ */ new Set(["role"]), boolean: boolFlags() });
  if (parsed.positionals.length === 0) throw new NeoError("usage", "remove: at least one skill name required");
  const role = await resolveRoleTarget(io, deps, lastFlag(parsed, "role"), "remove", false);
  const home = resolveHome(deps);
  const plan = await planRemove(home, { skills: parsed.positionals, role });
  for (const name of plan.missing) io.stderr(`remove ${name}: not found in role "${role}"
`);
  if (plan.items.length === 0) {
    return 1;
  }
  if (!parsed.bools.has("yes")) {
    const isTty = interactiveTty(deps);
    if (!isTty) {
      throw new NeoError("usage", "remove is destructive: pass --yes when not running interactively");
    }
    io.stdout(`will remove from role "${role}":
`);
    for (const item of plan.items) {
      const parts = [item.hasDir ? "dir" : null, item.hasLockEntry ? "lock entry" : null].filter((part) => part !== null).join(" + ");
      io.stdout(`  ${item.name} (${parts})
`);
    }
    const confirmed = await (deps.confirm ?? promptConfirm)("proceed with this removal?", false);
    if (!confirmed) {
      io.stderr("aborted, nothing removed\n");
      return 0;
    }
  }
  const report = await removeSkills({ link: nodeLinkPort() }, home, {
    skills: parsed.positionals,
    role,
    homedir: deps.homedir
  });
  for (const item of report.removed) io.stdout(`removed ${item.name} from role ${report.role}
`);
  for (const failure of report.failed) io.stderr(`remove ${failure.name}: ${failure.error}
`);
  if (report.convergeError !== void 0) io.stderr(`re-converge failed: ${report.convergeError}
`);
  let exit = report.ok ? 0 : 1;
  if (report.converge !== void 0) {
    const convergeExit = printConvergeReport(io, report.converge);
    if (exit === 0) exit = convergeExit;
  }
  return exit;
}
function reportError(io, error) {
  const neoError = error instanceof NeoError ? error : new NeoError("failure", error?.message ?? String(error));
  const hint = neoError.kind === "usage" ? '\n(run "neo --help" for usage)' : "";
  io.stderr(`neo: ${neoError.message}${hint}
`);
  return neoError.kind === "usage" ? 2 : 1;
}

// packages/cli/src/index.ts
process.stdout?.on?.("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
});
process.stderr?.on?.("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
});
runCli(process.argv.slice(2), {
  stdout: (text2) => process.stdout.write(text2),
  stderr: (text2) => process.stderr.write(text2)
}).then((code) => {
  process.exitCode = code;
}).catch((error) => {
  process.stderr.write(`neo: ${error?.message ?? String(error)}
`);
  process.exitCode = 1;
});
