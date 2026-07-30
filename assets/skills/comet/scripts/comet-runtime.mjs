#!/usr/bin/env node
import { createRequire as __cometCreateRequire } from 'module';
const require = __cometCreateRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/identity.js
var require_identity = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/identity.js"(exports) {
    "use strict";
    var ALIAS = /* @__PURE__ */ Symbol.for("yaml.alias");
    var DOC = /* @__PURE__ */ Symbol.for("yaml.document");
    var MAP = /* @__PURE__ */ Symbol.for("yaml.map");
    var PAIR = /* @__PURE__ */ Symbol.for("yaml.pair");
    var SCALAR = /* @__PURE__ */ Symbol.for("yaml.scalar");
    var SEQ = /* @__PURE__ */ Symbol.for("yaml.seq");
    var NODE_TYPE = /* @__PURE__ */ Symbol.for("yaml.node.type");
    var isAlias = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS;
    var isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
    var isMap2 = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
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
    exports.isMap = isMap2;
    exports.isNode = isNode;
    exports.isPair = isPair;
    exports.isScalar = isScalar;
    exports.isSeq = isSeq;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/visit.js
var require_visit = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/visit.js"(exports) {
    "use strict";
    var identity = require_identity();
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove node");
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
    function visit_(key, node, visitor, path32) {
      const ctrl = callVisitor(key, node, visitor, path32);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path32, ctrl);
        return visit_(key, ctrl, visitor, path32);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path32 = Object.freeze(path32.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = visit_(i, node.items[i], visitor, path32);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path32 = Object.freeze(path32.concat(node));
          const ck = visit_("key", node.key, visitor, path32);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = visit_("value", node.value, visitor, path32);
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
    async function visitAsync_(key, node, visitor, path32) {
      const ctrl = await callVisitor(key, node, visitor, path32);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path32, ctrl);
        return visitAsync_(key, ctrl, visitor, path32);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path32 = Object.freeze(path32.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = await visitAsync_(i, node.items[i], visitor, path32);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path32 = Object.freeze(path32.concat(node));
          const ck = await visitAsync_("key", node.key, visitor, path32);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = await visitAsync_("value", node.value, visitor, path32);
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
    function callVisitor(key, node, visitor, path32) {
      if (typeof visitor === "function")
        return visitor(key, node, path32);
      if (identity.isMap(node))
        return visitor.Map?.(key, node, path32);
      if (identity.isSeq(node))
        return visitor.Seq?.(key, node, path32);
      if (identity.isPair(node))
        return visitor.Pair?.(key, node, path32);
      if (identity.isScalar(node))
        return visitor.Scalar?.(key, node, path32);
      if (identity.isAlias(node))
        return visitor.Alias?.(key, node, path32);
      return void 0;
    }
    function replaceNode(key, path32, node) {
      const parent = path32[path32.length - 1];
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/directives.js
var require_directives = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/directives.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/anchors.js
var require_anchors = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/anchors.js"(exports) {
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
      for (let i = 1; true; ++i) {
        const name = `${prefix}${i}`;
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/applyReviver.js
var require_applyReviver = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/applyReviver.js"(exports) {
    "use strict";
    function applyReviver(reviver, obj, key, val) {
      if (val && typeof val === "object") {
        if (Array.isArray(val)) {
          for (let i = 0, len = val.length; i < len; ++i) {
            const v0 = val[i];
            const v1 = applyReviver(reviver, val, String(i), v0);
            if (v1 === void 0)
              delete val[i];
            else if (v1 !== v0)
              val[i] = v1;
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/toJS.js
var require_toJS = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/toJS.js"(exports) {
    "use strict";
    var identity = require_identity();
    function toJS(value, arg, ctx) {
      if (Array.isArray(value))
        return value.map((v, i) => toJS(v, String(i), ctx));
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Node.js
var require_Node = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Node.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Alias.js
var require_Alias = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Alias.js"(exports) {
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
        return found;
      }
      toJSON(_arg, ctx) {
        if (!ctx)
          return { source: this.source };
        const { anchors: anchors2, doc, maxAliasCount } = ctx;
        const source = this.resolve(doc, ctx);
        if (!source) {
          const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
          throw new ReferenceError(msg);
        }
        let data = anchors2.get(source);
        if (!data) {
          toJS.toJS(source, null, ctx);
          data = anchors2.get(source);
        }
        if (data?.res === void 0) {
          const msg = "This should not happen: Alias anchor was not resolved?";
          throw new ReferenceError(msg);
        }
        if (maxAliasCount >= 0) {
          data.count += 1;
          if (data.aliasCount === 0)
            data.aliasCount = getAliasCount(doc, source, anchors2);
          if (data.count * data.aliasCount > maxAliasCount) {
            const msg = "Excessive alias count indicates a resource exhaustion attack";
            throw new ReferenceError(msg);
          }
        }
        return data.res;
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
          const c = getAliasCount(doc, item, anchors2);
          if (c > count)
            count = c;
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Scalar.js
var require_Scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Scalar.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/createNode.js
var require_createNode = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/createNode.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var defaultTagPrefix = "tag:yaml.org,2002:";
    function findTagObject(value, tagName, tags) {
      if (tagName) {
        const match = tags.filter((t) => t.tag === tagName);
        const tagObj = match.find((t) => !t.format) ?? match[0];
        if (!tagObj)
          throw new Error(`Tag ${tagName} not found`);
        return tagObj;
      }
      return tags.find((t) => t.identify?.(value) && !t.format);
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Collection.js
var require_Collection = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Collection.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var identity = require_identity();
    var Node = require_Node();
    function collectionFromPath(schema, path32, value) {
      let v = value;
      for (let i = path32.length - 1; i >= 0; --i) {
        const k = path32[i];
        if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
          const a = [];
          a[k] = v;
          v = a;
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
    var isEmptyPath = (path32) => path32 == null || typeof path32 === "object" && !!path32[Symbol.iterator]().next().done;
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
      addIn(path32, value) {
        if (isEmptyPath(path32))
          this.add(value);
        else {
          const [key, ...rest] = path32;
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
      deleteIn(path32) {
        const [key, ...rest] = path32;
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
      getIn(path32, keepScalar) {
        const [key, ...rest] = path32;
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
          const n = node.value;
          return n == null || allowScalar && identity.isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
        });
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       */
      hasIn(path32) {
        const [key, ...rest] = path32;
        if (rest.length === 0)
          return this.has(key);
        const node = this.get(key, true);
        return identity.isCollection(node) ? node.hasIn(rest) : false;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path32, value) {
        const [key, ...rest] = path32;
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyComment.js
var require_stringifyComment = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyComment.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/foldFlowLines.js
var require_foldFlowLines = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/foldFlowLines.js"(exports) {
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
      let i = -1;
      let escStart = -1;
      let escEnd = -1;
      if (mode === FOLD_BLOCK) {
        i = consumeMoreIndentedLines(text2, i, indent.length);
        if (i !== -1)
          end = i + endStep;
      }
      for (let ch; ch = text2[i += 1]; ) {
        if (mode === FOLD_QUOTED && ch === "\\") {
          escStart = i;
          switch (text2[i + 1]) {
            case "x":
              i += 3;
              break;
            case "u":
              i += 5;
              break;
            case "U":
              i += 9;
              break;
            default:
              i += 1;
          }
          escEnd = i;
        }
        if (ch === "\n") {
          if (mode === FOLD_BLOCK)
            i = consumeMoreIndentedLines(text2, i, indent.length);
          end = i + indent.length + endStep;
          split = void 0;
        } else {
          if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
            const next2 = text2[i + 1];
            if (next2 && next2 !== " " && next2 !== "\n" && next2 !== "	")
              split = i;
          }
          if (i >= end) {
            if (split) {
              folds.push(split);
              end = split + endStep;
              split = void 0;
            } else if (mode === FOLD_QUOTED) {
              while (prev === " " || prev === "	") {
                prev = ch;
                ch = text2[i += 1];
                overflow = true;
              }
              const j = i > escEnd + 1 ? i - 2 : escStart - 1;
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
      for (let i2 = 0; i2 < folds.length; ++i2) {
        const fold = folds[i2];
        const end2 = folds[i2 + 1] || text2.length;
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
    function consumeMoreIndentedLines(text2, i, indent) {
      let end = i;
      let start = i + 1;
      let ch = text2[start];
      while (ch === " " || ch === "	") {
        if (i < start + indent) {
          ch = text2[++i];
        } else {
          do {
            ch = text2[++i];
          } while (ch && ch !== "\n");
          end = i;
          start = i + 1;
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyString.js
var require_stringifyString = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyString.js"(exports) {
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
      for (let i = 0, start = 0; i < strLen; ++i) {
        if (str[i] === "\n") {
          if (i - start > limit)
            return true;
          start = i + 1;
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
      for (let i = 0, ch = json[i]; ch; ch = json[++i]) {
        if (ch === " " && json[i + 1] === "\\" && json[i + 2] === "n") {
          str += json.slice(start, i) + "\\ ";
          i += 1;
          start = i;
          ch = "\\";
        }
        if (ch === "\\")
          switch (json[i + 1]) {
            case "u":
              {
                str += json.slice(start, i);
                const code = json.substr(i + 2, 4);
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
                      str += json.substr(i, 6);
                }
                i += 5;
                start = i + 1;
              }
              break;
            case "n":
              if (implicitKey || json[i + 2] === '"' || json.length < minMultiLineLength) {
                i += 1;
              } else {
                str += json.slice(start, i) + "\n\n";
                while (json[i + 2] === "\\" && json[i + 3] === "n" && json[i + 4] !== '"') {
                  str += "\n";
                  i += 2;
                }
                str += indent;
                if (json[i + 2] === " ")
                  str += "\\";
                i += 1;
                start = i + 1;
              }
              break;
            default:
              i += 1;
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
        const t = implicitKey && defaultKeyType || defaultStringType;
        res = _stringify(t);
        if (res === null)
          throw new Error(`Unsupported default string type ${t}`);
      }
      return res;
    }
    exports.stringifyString = stringifyString;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringify.js
var require_stringify = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringify.js"(exports) {
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
        const match = tags.filter((t) => t.tag === item.tag);
        if (match.length > 0)
          return match.find((t) => t.format === item.format) ?? match[0];
      }
      let tagObj = void 0;
      let obj;
      if (identity.isScalar(item)) {
        obj = item.value;
        let match = tags.filter((t) => t.identify?.(obj));
        if (match.length > 1) {
          const testMatch = match.filter((t) => t.test);
          if (testMatch.length > 0)
            match = testMatch;
        }
        tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
      } else {
        obj = item;
        tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
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
    function stringify2(item, ctx, onComment, onChompKeep) {
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
    exports.stringify = stringify2;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyPair.js
var require_stringifyPair = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyPair.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var stringify2 = require_stringify();
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
      let str = stringify2.stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
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
      const valueStr = stringify2.stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/log.js
var require_log = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/log.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/merge.js
var require_merge = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/merge.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/addPairToJSMap.js
var require_addPairToJSMap = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/addPairToJSMap.js"(exports) {
    "use strict";
    var log = require_log();
    var merge = require_merge();
    var stringify2 = require_stringify();
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
        const strCtx = stringify2.createStringifyContext(ctx.doc, {});
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Pair.js
var require_Pair = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Pair.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyCollection.js
var require_stringifyCollection = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyCollection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var stringify2 = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyCollection(collection, ctx, options) {
      const flow = ctx.inFlow ?? collection.flow;
      const stringify3 = flow ? stringifyFlowCollection : stringifyBlockCollection;
      return stringify3(collection, ctx, options);
    }
    function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
      const { indent, options: { commentString } } = ctx;
      const itemCtx = Object.assign({}, ctx, { indent: itemIndent, type: null });
      let chompKeep = false;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
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
        let str2 = stringify2.stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
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
        for (let i = 1; i < lines.length; ++i) {
          const line = lines[i];
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
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
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
        let str = stringify2.stringify(item, itemCtx, () => comment = null);
        reqNewline || (reqNewline = lines.length > linesAtValue || str.includes("\n"));
        if (i < items.length - 1) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/YAMLMap.js
var require_YAMLMap = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/YAMLMap.js"(exports) {
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
          const i = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
          if (i === -1)
            this.items.push(_pair);
          else
            this.items.splice(i, 0, _pair);
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/map.js
var require_map = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/map.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/YAMLSeq.js
var require_YAMLSeq = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/YAMLSeq.js"(exports) {
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
        let i = 0;
        for (const item of this.items)
          seq.push(toJS.toJS(item, String(i++), ctx));
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
          let i = 0;
          for (let it of obj) {
            if (typeof replacer === "function") {
              const key = obj instanceof Set ? it : String(i++);
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/seq.js
var require_seq = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/seq.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/string.js
var require_string = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/string.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/null.js
var require_null = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/null.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/bool.js
var require_bool = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/bool.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyNumber.js
var require_stringifyNumber = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyNumber.js"(exports) {
    "use strict";
    function stringifyNumber({ format, minFractionDigits, tag, value }) {
      if (typeof value === "bigint")
        return String(value);
      const num = typeof value === "number" ? value : Number(value);
      if (!isFinite(num))
        return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
      let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
      if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n) && !n.includes("e")) {
        let i = n.indexOf(".");
        if (i < 0) {
          i = n.length;
          n += ".";
        }
        let d = minFractionDigits - (n.length - i - 1);
        while (d-- > 0)
          n += "0";
      }
      return n;
    }
    exports.stringifyNumber = stringifyNumber;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/float.js
var require_float = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/float.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/int.js
var require_int = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/int.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/schema.js
var require_schema = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/schema.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/json/schema.js
var require_schema2 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/json/schema.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/binary.js
var require_binary = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/binary.js"(exports) {
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
          for (let i = 0; i < str.length; ++i)
            buffer[i] = str.charCodeAt(i);
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
          for (let i = 0; i < buf.length; ++i)
            s += String.fromCharCode(buf[i]);
          str = btoa(s);
        } else {
          throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
        }
        type ?? (type = Scalar.Scalar.BLOCK_LITERAL);
        if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
          const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
          const n = Math.ceil(str.length / lineWidth);
          const lines = new Array(n);
          for (let i = 0, o = 0; i < n; ++i, o += lineWidth) {
            lines[i] = str.substr(o, lineWidth);
          }
          str = lines.join(type === Scalar.Scalar.BLOCK_LITERAL ? "\n" : " ");
        }
        return stringifyString.stringifyString({ comment, type, value: str }, ctx, onComment, onChompKeep);
      }
    };
    exports.binary = binary;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/pairs.js
var require_pairs = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/pairs.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLSeq = require_YAMLSeq();
    function resolvePairs(seq, onError) {
      if (identity.isSeq(seq)) {
        for (let i = 0; i < seq.items.length; ++i) {
          let item = seq.items[i];
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
          seq.items[i] = identity.isPair(item) ? item : new Pair.Pair(item);
        }
      } else
        onError("Expected a sequence for this tag");
      return seq;
    }
    function createPairs(schema, iterable, ctx) {
      const { replacer } = ctx;
      const pairs2 = new YAMLSeq.YAMLSeq(schema);
      pairs2.tag = "tag:yaml.org,2002:pairs";
      let i = 0;
      if (iterable && Symbol.iterator in Object(iterable))
        for (let it of iterable) {
          if (typeof replacer === "function")
            it = replacer.call(iterable, String(i++), it);
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/omap.js
var require_omap = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/omap.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/bool.js
var require_bool2 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/bool.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/float.js
var require_float2 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/float.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/int.js
var require_int2 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/int.js"(exports) {
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
        const n2 = BigInt(str);
        return sign === "-" ? BigInt(-1) * n2 : n2;
      }
      const n = parseInt(str, radix);
      return sign === "-" ? -1 * n : n;
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/set.js
var require_set = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/set.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/timestamp.js
var require_timestamp = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/timestamp.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    function parseSexagesimal(str, asBigInt) {
      const sign = str[0];
      const parts = sign === "-" || sign === "+" ? str.substring(1) : str;
      const num = (n) => asBigInt ? BigInt(n) : Number(n);
      const res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num(60) + num(p), num(0));
      return sign === "-" ? num(-1) * res : res;
    }
    function stringifySexagesimal(node) {
      let { value } = node;
      let num = (n) => n;
      if (typeof value === "bigint")
        num = (n) => BigInt(n);
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
      return sign + parts.map((n) => String(n).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/schema.js
var require_schema3 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/schema.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/tags.js
var require_tags = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/tags.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/Schema.js
var require_Schema = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/Schema.js"(exports) {
    "use strict";
    var identity = require_identity();
    var map = require_map();
    var seq = require_seq();
    var string = require_string();
    var tags = require_tags();
    var sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyDocument.js
var require_stringifyDocument = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyDocument.js"(exports) {
    "use strict";
    var identity = require_identity();
    var stringify2 = require_stringify();
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
      const ctx = stringify2.createStringifyContext(doc, options);
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
        let body = stringify2.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
        if (contentComment)
          body += stringifyComment.lineComment(body, "", commentString(contentComment));
        if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") {
          lines[lines.length - 1] = `--- ${body}`;
        } else
          lines.push(body);
      } else {
        lines.push(stringify2.stringify(doc.contents, ctx));
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/Document.js
var require_Document = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/Document.js"(exports) {
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
    var Document3 = class _Document {
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
      addIn(path32, value) {
        if (assertCollection(this.contents))
          this.contents.addIn(path32, value);
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
      deleteIn(path32) {
        if (Collection.isEmptyPath(path32)) {
          if (this.contents == null)
            return false;
          this.contents = null;
          return true;
        }
        return assertCollection(this.contents) ? this.contents.deleteIn(path32) : false;
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
      getIn(path32, keepScalar) {
        if (Collection.isEmptyPath(path32))
          return !keepScalar && identity.isScalar(this.contents) ? this.contents.value : this.contents;
        return identity.isCollection(this.contents) ? this.contents.getIn(path32, keepScalar) : void 0;
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
      hasIn(path32) {
        if (Collection.isEmptyPath(path32))
          return this.contents !== void 0;
        return identity.isCollection(this.contents) ? this.contents.hasIn(path32) : false;
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
      setIn(path32, value) {
        if (Collection.isEmptyPath(path32)) {
          this.contents = value;
        } else if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, Array.from(path32), value);
        } else if (assertCollection(this.contents)) {
          this.contents.setIn(path32, value);
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
    exports.Document = Document3;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/errors.js
var require_errors = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/errors.js"(exports) {
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
        lineStr = "…" + lineStr.substring(trimStart);
        ci -= trimStart - 1;
      }
      if (lineStr.length > 80)
        lineStr = lineStr.substring(0, 79) + "…";
      if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
        let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
        if (prev.length > 80)
          prev = prev.substring(0, 79) + "…\n";
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-props.js
var require_resolve_props = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-props.js"(exports) {
    "use strict";
    function resolveProps(tokens, { flow, indicator, next: next2, offset, onError, parentIndent, startOnNewline }) {
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
            if (!flow && (indicator !== "doc-start" || next2?.type !== "flow-collection") && token.source.includes("	")) {
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
      if (reqSpace && next2 && next2.type !== "space" && next2.type !== "newline" && next2.type !== "comma" && (next2.type !== "scalar" || next2.source !== "")) {
        onError(next2.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
      }
      if (tab && (atNewline && tab.indent <= parentIndent || next2?.type === "block-map" || next2?.type === "block-seq"))
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-contains-newline.js
var require_util_contains_newline = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-contains-newline.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-flow-indent-check.js
var require_util_flow_indent_check = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-flow-indent-check.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-map-includes.js
var require_util_map_includes = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-map-includes.js"(exports) {
    "use strict";
    var identity = require_identity();
    function mapIncludes(ctx, items, search) {
      const { uniqueKeys } = ctx.options;
      if (uniqueKeys === false)
        return false;
      const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a, b) => a === b || identity.isScalar(a) && identity.isScalar(b) && a.value === b.value;
      return items.some((pair) => isEqual(pair.key, search));
    }
    exports.mapIncludes = mapIncludes;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-map.js
var require_resolve_block_map = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-map.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-seq.js
var require_resolve_block_seq = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-seq.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-end.js
var require_resolve_end = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-end.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-flow-collection.js
var require_resolve_flow_collection = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-flow-collection.js"(exports) {
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
      const isMap2 = fc.start.source === "{";
      const fcName = isMap2 ? "flow map" : "flow sequence";
      const NodeClass = tag?.nodeClass ?? (isMap2 ? YAMLMap.YAMLMap : YAMLSeq.YAMLSeq);
      const coll = new NodeClass(ctx.schema);
      coll.flow = true;
      const atRoot = ctx.atRoot;
      if (atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = fc.offset + fc.start.source.length;
      for (let i = 0; i < fc.items.length; ++i) {
        const collItem = fc.items[i];
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
            if (i === 0 && props.comma)
              onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
            else if (i < fc.items.length - 1)
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
          if (!isMap2 && ctx.options.strict && utilContainsNewline.containsNewline(key))
            onError(
              key,
              // checked by containsNewline()
              "MULTILINE_IMPLICIT_KEY",
              "Implicit keys of flow sequence pairs need to be on a single line"
            );
        }
        if (i === 0) {
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
        if (!isMap2 && !sep && !props.found) {
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
            if (!isMap2 && !props.found && ctx.options.strict) {
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
          if (isMap2) {
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
      const expectedEnd = isMap2 ? "}" : "]";
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-collection.js
var require_compose_collection = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-collection.js"(exports) {
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
      let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-scalar.js
var require_resolve_block_scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function resolveBlockScalar(ctx, scalar2, onError) {
      const start = scalar2.offset;
      const header = parseBlockScalarHeader(scalar2, ctx.options.strict, onError);
      if (!header)
        return { value: "", type: null, comment: "", range: [start, start, start] };
      const type = header.mode === ">" ? Scalar.Scalar.BLOCK_FOLDED : Scalar.Scalar.BLOCK_LITERAL;
      const lines = scalar2.source ? splitLines(scalar2.source) : [];
      let chompStart = lines.length;
      for (let i = lines.length - 1; i >= 0; --i) {
        const content = lines[i][1];
        if (content === "" || content === "\r")
          chompStart = i;
        else
          break;
      }
      if (chompStart === 0) {
        const value2 = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "";
        let end2 = start + header.length;
        if (scalar2.source)
          end2 += scalar2.source.length;
        return { value: value2, type, comment: header.comment, range: [start, end2, end2] };
      }
      let trimIndent = scalar2.indent + header.indent;
      let offset = scalar2.offset + header.length;
      let contentStart = 0;
      for (let i = 0; i < chompStart; ++i) {
        const [indent, content] = lines[i];
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
          contentStart = i;
          if (trimIndent === 0 && !ctx.atRoot) {
            const message = "Block scalar values in collections must be indented";
            onError(offset, "BAD_INDENT", message);
          }
          break;
        }
        offset += indent.length + content.length + 1;
      }
      for (let i = lines.length - 1; i >= chompStart; --i) {
        if (lines[i][0].length > trimIndent)
          chompStart = i + 1;
      }
      let value = "";
      let sep = "";
      let prevMoreIndented = false;
      for (let i = 0; i < contentStart; ++i)
        value += lines[i][0].slice(trimIndent) + "\n";
      for (let i = contentStart; i < chompStart; ++i) {
        let [indent, content] = lines[i];
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
          for (let i = chompStart; i < lines.length; ++i)
            value += "\n" + lines[i][0].slice(trimIndent);
          if (value[value.length - 1] !== "\n")
            value += "\n";
          break;
        default:
          value += "\n";
      }
      const end = start + header.length + scalar2.source.length;
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
      for (let i = 1; i < source.length; ++i) {
        const ch = source[i];
        if (!chomp && (ch === "-" || ch === "+"))
          chomp = ch;
        else {
          const n = Number(ch);
          if (!indent && n)
            indent = n;
          else if (error === -1)
            error = offset + i;
        }
      }
      if (error !== -1)
        onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
      let hasSpace = false;
      let comment = "";
      let length = source.length;
      for (let i = 1; i < props.length; ++i) {
        const token = props[i];
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
      const m = first.match(/^( *)/);
      const line0 = m?.[1] ? [m[1], first.slice(m[1].length)] : ["", first];
      const lines = [line0];
      for (let i = 1; i < split.length; i += 2)
        lines.push([split[i], split[i + 1]]);
      return lines;
    }
    exports.resolveBlockScalar = resolveBlockScalar;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-flow-scalar.js
var require_resolve_flow_scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-flow-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var resolveEnd = require_resolve_end();
    function resolveFlowScalar(scalar2, strict, onError) {
      const { offset, type, source, end } = scalar2;
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
          onError(scalar2, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
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
      return foldLines(source);
    }
    function singleQuotedValue(source, onError) {
      if (source[source.length - 1] !== "'" || source.length === 1)
        onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
      return foldLines(source.slice(1, -1)).replace(/''/g, "'");
    }
    function foldLines(source) {
      let first, line;
      try {
        first = new RegExp("(.*?)(?<![ 	])[ 	]*\r?\n", "sy");
        line = new RegExp("[ 	]*(.*?)(?:(?<![ 	])[ 	]*)?\r?\n", "sy");
      } catch {
        first = /(.*?)[ \t]*\r?\n/sy;
        line = /[ \t]*(.*?)[ \t]*\r?\n/sy;
      }
      let match = first.exec(source);
      if (!match)
        return source;
      let res = match[1];
      let sep = " ";
      let pos = first.lastIndex;
      line.lastIndex = pos;
      while (match = line.exec(source)) {
        if (match[1] === "") {
          if (sep === "\n")
            res += sep;
          else
            sep = "\n";
        } else {
          res += sep + match[1];
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
      for (let i = 1; i < source.length - 1; ++i) {
        const ch = source[i];
        if (ch === "\r" && source[i + 1] === "\n")
          continue;
        if (ch === "\n") {
          const { fold, offset } = foldNewline(source, i);
          res += fold;
          i = offset;
        } else if (ch === "\\") {
          let next2 = source[++i];
          const cc = escapeCodes[next2];
          if (cc)
            res += cc;
          else if (next2 === "\n") {
            next2 = source[i + 1];
            while (next2 === " " || next2 === "	")
              next2 = source[++i + 1];
          } else if (next2 === "\r" && source[i + 1] === "\n") {
            next2 = source[++i + 1];
            while (next2 === " " || next2 === "	")
              next2 = source[++i + 1];
          } else if (next2 === "x" || next2 === "u" || next2 === "U") {
            const length = next2 === "x" ? 2 : next2 === "u" ? 4 : 8;
            res += parseCharCode(source, i + 1, length, onError);
            i += length;
          } else {
            const raw = source.substr(i - 1, 2);
            onError(i - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
            res += raw;
          }
        } else if (ch === " " || ch === "	") {
          const wsStart = i;
          let next2 = source[i + 1];
          while (next2 === " " || next2 === "	")
            next2 = source[++i + 1];
          if (next2 !== "\n" && !(next2 === "\r" && source[i + 2] === "\n"))
            res += i > wsStart ? source.slice(wsStart, i + 1) : ch;
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
      N: "",
      // Unicode next line
      _: " ",
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-scalar.js
var require_compose_scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-scalar.js"(exports) {
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
      let scalar2;
      try {
        const res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
        scalar2 = identity.isScalar(res) ? res : new Scalar.Scalar(res);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
        scalar2 = new Scalar.Scalar(value);
      }
      scalar2.range = range;
      scalar2.source = value;
      if (type)
        scalar2.type = type;
      if (tagName)
        scalar2.tag = tagName;
      if (tag.format)
        scalar2.format = tag.format;
      if (comment)
        scalar2.comment = comment;
      return scalar2;
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-empty-scalar-position.js
var require_util_empty_scalar_position = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-empty-scalar-position.js"(exports) {
    "use strict";
    function emptyScalarPosition(offset, before, pos) {
      if (before) {
        pos ?? (pos = before.length);
        for (let i = pos - 1; i >= 0; --i) {
          let st = before[i];
          switch (st.type) {
            case "space":
            case "comment":
            case "newline":
              offset -= st.source.length;
              continue;
          }
          st = before[++i];
          while (st?.type === "space") {
            offset += st.source.length;
            st = before[++i];
          }
          break;
        }
      }
      return offset;
    }
    exports.emptyScalarPosition = emptyScalarPosition;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-node.js
var require_compose_node = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-node.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-doc.js
var require_compose_doc = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-doc.js"(exports) {
    "use strict";
    var Document3 = require_Document();
    var composeNode = require_compose_node();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    function composeDoc(options, directives, { offset, start, value, end }, onError) {
      const opts = Object.assign({ _directives: directives }, options);
      const doc = new Document3.Document(void 0, opts);
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/composer.js
var require_composer = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/composer.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var directives = require_directives();
    var Document3 = require_Document();
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
      for (let i = 0; i < prelude.length; ++i) {
        const source = prelude[i];
        switch (source[0]) {
          case "#":
            comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
            atComment = true;
            afterEmptyLine = false;
            break;
          case "%":
            if (prelude[i + 1]?.[0] !== "#")
              i += 1;
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
          for (let i = 0; i < this.errors.length; ++i)
            doc.errors.push(this.errors[i]);
          for (let i = 0; i < this.warnings.length; ++i)
            doc.warnings.push(this.warnings[i]);
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
          const doc = new Document3.Document(void 0, opts);
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-scalar.js
var require_cst_scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-scalar.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-stringify.js
var require_cst_stringify = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-stringify.js"(exports) {
    "use strict";
    var stringify2 = (cst) => "type" in cst ? stringifyToken(cst) : stringifyItem(cst);
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
    exports.stringify = stringify2;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-visit.js
var require_cst_visit = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-visit.js"(exports) {
    "use strict";
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove item");
    function visit(cst, visitor) {
      if ("type" in cst && cst.type === "document")
        cst = { start: cst.start, value: cst.value };
      _visit(Object.freeze([]), cst, visitor);
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    visit.itemAtPath = (cst, path32) => {
      let item = cst;
      for (const [field2, index] of path32) {
        const tok = item?.[field2];
        if (tok && "items" in tok) {
          item = tok.items[index];
        } else
          return void 0;
      }
      return item;
    };
    visit.parentCollection = (cst, path32) => {
      const parent = visit.itemAtPath(cst, path32.slice(0, -1));
      const field2 = path32[path32.length - 1][0];
      const coll = parent?.[field2];
      if (coll && "items" in coll)
        return coll;
      throw new Error("Parent collection not found");
    };
    function _visit(path32, item, visitor) {
      let ctrl = visitor(item, path32);
      if (typeof ctrl === "symbol")
        return ctrl;
      for (const field2 of ["key", "value"]) {
        const token = item[field2];
        if (token && "items" in token) {
          for (let i = 0; i < token.items.length; ++i) {
            const ci = _visit(Object.freeze(path32.concat([[field2, i]])), token.items[i], visitor);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              token.items.splice(i, 1);
              i -= 1;
            }
          }
          if (typeof ctrl === "function" && field2 === "key")
            ctrl = ctrl(item, path32);
        }
      }
      return typeof ctrl === "function" ? ctrl(item, path32) : ctrl;
    }
    exports.visit = visit;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst.js
var require_cst = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/lexer.js
var require_lexer = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/lexer.js"(exports) {
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
        let next2 = this.next ?? "stream";
        while (next2 && (incomplete || this.hasChars(1)))
          next2 = yield* this.parseNext(next2);
      }
      atLineEnd() {
        let i = this.pos;
        let ch = this.buffer[i];
        while (ch === " " || ch === "	")
          ch = this.buffer[++i];
        if (!ch || ch === "#" || ch === "\n")
          return true;
        if (ch === "\r")
          return this.buffer[i + 1] === "\n";
        return false;
      }
      charAt(n) {
        return this.buffer[this.pos + n];
      }
      continueScalar(offset) {
        let ch = this.buffer[offset];
        if (this.indentNext > 0) {
          let indent = 0;
          while (ch === " ")
            ch = this.buffer[++indent + offset];
          if (ch === "\r") {
            const next2 = this.buffer[indent + offset + 1];
            if (next2 === "\n" || !next2 && !this.atEnd)
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
      hasChars(n) {
        return this.pos + n <= this.buffer.length;
      }
      setNext(state) {
        this.buffer = this.buffer.substring(this.pos);
        this.pos = 0;
        this.lineEndPos = null;
        this.next = state;
        return null;
      }
      peek(n) {
        return this.buffer.substr(this.pos, n);
      }
      *parseNext(next2) {
        switch (next2) {
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
          const n = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
          yield* this.pushCount(line.length - n);
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
          const n = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
          this.indentNext = this.indentValue + 1;
          this.indentValue += n;
          return "block-start";
        }
        return "doc";
      }
      *parseDocument() {
        yield* this.pushSpaces(true);
        const line = this.getLine();
        if (line === null)
          return this.setNext("doc");
        let n = yield* this.pushIndicators();
        switch (line[n]) {
          case "#":
            yield* this.pushCount(line.length - n);
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
            n += yield* this.parseBlockScalarHeader();
            n += yield* this.pushSpaces(true);
            yield* this.pushCount(line.length - n);
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
        let n = 0;
        while (line[n] === ",") {
          n += yield* this.pushCount(1);
          n += yield* this.pushSpaces(true);
          this.flowKey = false;
        }
        n += yield* this.pushIndicators();
        switch (line[n]) {
          case void 0:
            return "flow";
          case "#":
            yield* this.pushCount(line.length - n);
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
            const next2 = this.charAt(1);
            if (this.flowKey || isEmpty(next2) || next2 === ",") {
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
            let n = 0;
            while (this.buffer[end - 1 - n] === "\\")
              n += 1;
            if (n % 2 === 0)
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
        let i = this.pos;
        while (true) {
          const ch = this.buffer[++i];
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
        loop: for (let i2 = this.pos; ch = this.buffer[i2]; ++i2) {
          switch (ch) {
            case " ":
              indent += 1;
              break;
            case "\n":
              nl = i2;
              indent = 0;
              break;
            case "\r": {
              const next2 = this.buffer[i2 + 1];
              if (!next2 && !this.atEnd)
                return this.setNext("block-scalar");
              if (next2 === "\n")
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
        let i = nl + 1;
        ch = this.buffer[i];
        while (ch === " ")
          ch = this.buffer[++i];
        if (ch === "	") {
          while (ch === "	" || ch === " " || ch === "\r" || ch === "\n")
            ch = this.buffer[++i];
          nl = i - 1;
        } else if (!this.blockScalarKeep) {
          do {
            let i2 = nl - 1;
            let ch2 = this.buffer[i2];
            if (ch2 === "\r")
              ch2 = this.buffer[--i2];
            const lastChar = i2;
            while (ch2 === " ")
              ch2 = this.buffer[--i2];
            if (ch2 === "\n" && i2 >= this.pos && i2 + 1 + indent > lastChar)
              nl = i2;
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
        let i = this.pos - 1;
        let ch;
        while (ch = this.buffer[++i]) {
          if (ch === ":") {
            const next2 = this.buffer[i + 1];
            if (isEmpty(next2) || inFlow && flowIndicatorChars.has(next2))
              break;
            end = i;
          } else if (isEmpty(ch)) {
            let next2 = this.buffer[i + 1];
            if (ch === "\r") {
              if (next2 === "\n") {
                i += 1;
                ch = "\n";
                next2 = this.buffer[i + 1];
              } else
                end = i;
            }
            if (next2 === "#" || inFlow && flowIndicatorChars.has(next2))
              break;
            if (ch === "\n") {
              const cs = this.continueScalar(i + 1);
              if (cs === -1)
                break;
              i = Math.max(i, cs - 2);
            }
          } else {
            if (inFlow && flowIndicatorChars.has(ch))
              break;
            end = i;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("plain-scalar");
        yield cst.SCALAR;
        yield* this.pushToIndex(end + 1, true);
        return inFlow ? "flow" : "doc";
      }
      *pushCount(n) {
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos += n;
          return n;
        }
        return 0;
      }
      *pushToIndex(i, allowEmpty) {
        const s = this.buffer.slice(this.pos, i);
        if (s) {
          yield s;
          this.pos += s.length;
          return s.length;
        } else if (allowEmpty)
          yield "";
        return 0;
      }
      *pushIndicators() {
        let n = 0;
        loop: while (true) {
          switch (this.charAt(0)) {
            case "!":
              n += yield* this.pushTag();
              n += yield* this.pushSpaces(true);
              continue loop;
            case "&":
              n += yield* this.pushUntil(isNotAnchorChar);
              n += yield* this.pushSpaces(true);
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
                n += yield* this.pushCount(1);
                n += yield* this.pushSpaces(true);
                continue loop;
              }
            }
          }
          break loop;
        }
        return n;
      }
      *pushTag() {
        if (this.charAt(1) === "<") {
          let i = this.pos + 2;
          let ch = this.buffer[i];
          while (!isEmpty(ch) && ch !== ">")
            ch = this.buffer[++i];
          return yield* this.pushToIndex(ch === ">" ? i + 1 : i, false);
        } else {
          let i = this.pos + 1;
          let ch = this.buffer[i];
          while (ch) {
            if (tagChars.has(ch))
              ch = this.buffer[++i];
            else if (ch === "%" && hexDigits.has(this.buffer[i + 1]) && hexDigits.has(this.buffer[i + 2])) {
              ch = this.buffer[i += 3];
            } else
              break;
          }
          return yield* this.pushToIndex(i, false);
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
        let i = this.pos - 1;
        let ch;
        do {
          ch = this.buffer[++i];
        } while (ch === " " || allowTabs && ch === "	");
        const n = i - this.pos;
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos = i;
        }
        return n;
      }
      *pushUntil(test) {
        let i = this.pos;
        let ch = this.buffer[i];
        while (!test(ch))
          ch = this.buffer[++i];
        return yield* this.pushToIndex(i, false);
      }
    };
    exports.Lexer = Lexer;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/line-counter.js
var require_line_counter = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/line-counter.js"(exports) {
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/parser.js
var require_parser = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/parser.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var cst = require_cst();
    var lexer = require_lexer();
    function includesToken(list, type) {
      for (let i = 0; i < list.length; ++i)
        if (list[i].type === type)
          return true;
      return false;
    }
    function findNonEmptyIndex(list) {
      for (let i = 0; i < list.length; ++i) {
        switch (list[i].type) {
          case "space":
          case "comment":
          case "newline":
            break;
          default:
            return i;
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
      let i = prev.length;
      loop: while (--i >= 0) {
        switch (prev[i].type) {
          case "doc-start":
          case "explicit-key-ind":
          case "map-value-ind":
          case "seq-item-ind":
          case "newline":
            break loop;
        }
      }
      while (prev[++i]?.type === "space") {
      }
      return prev.splice(i, prev.length);
    }
    function arrayPushArray(target, source) {
      if (source.length < 1e5)
        Array.prototype.push.apply(target, source);
      else
        for (let i = 0; i < source.length; ++i)
          target.push(source[i]);
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
      peek(n) {
        return this.stack[this.stack.length - n];
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
      *scalar(scalar2) {
        if (this.type === "map-value-ind") {
          const prev = getPrevProps(this.peek(2));
          const start = getFirstKeyStartProps(prev);
          let sep;
          if (scalar2.end) {
            sep = scalar2.end;
            sep.push(this.sourceToken);
            delete scalar2.end;
          } else
            sep = [this.sourceToken];
          const map = {
            type: "block-map",
            offset: scalar2.offset,
            indent: scalar2.indent,
            items: [{ start, key: scalar2, sep }]
          };
          this.onKeyLine = true;
          this.stack[this.stack.length - 1] = map;
        } else
          yield* this.lineEnd(scalar2);
      }
      *blockScalar(scalar2) {
        switch (this.type) {
          case "space":
          case "comment":
          case "newline":
            scalar2.props.push(this.sourceToken);
            return;
          case "scalar":
            scalar2.source = this.source;
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
            for (let i = 0; i < it.sep.length; ++i) {
              const st = it.sep[i];
              switch (st.type) {
                case "newline":
                  nl.push(i);
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
              const fs23 = this.flowScalar(this.type);
              if (atNextItem || it.value) {
                map.items.push({ start, key: fs23, sep: [] });
                this.onKeyLine = true;
              } else if (it.sep) {
                this.stack.push(fs23);
              } else {
                Object.assign(it, { key: fs23, sep: [] });
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
              const fs23 = this.flowScalar(this.type);
              if (!it || it.value)
                fc.items.push({ start: [], key: fs23, sep: [] });
              else if (it.sep)
                this.stack.push(fs23);
              else
                Object.assign(it, { key: fs23, sep: [] });
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

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/public-api.js
var require_public_api = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/public-api.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document3 = require_Document();
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
    function parseDocument9(source, options = {}) {
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
    function parse2(src, reviver, options) {
      let _reviver = void 0;
      if (typeof reviver === "function") {
        _reviver = reviver;
      } else if (options === void 0 && reviver && typeof reviver === "object") {
        options = reviver;
      }
      const doc = parseDocument9(src, options);
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
    function stringify2(value, replacer, options) {
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
      return new Document3.Document(value, _replacer, options).toString(options);
    }
    exports.parse = parse2;
    exports.parseAllDocuments = parseAllDocuments;
    exports.parseDocument = parseDocument9;
    exports.stringify = stringify2;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/index.js
var require_dist = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/index.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document3 = require_Document();
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
    exports.Document = Document3.Document;
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

// domains/workflow-contract/project-config.ts
import path from "path";
function projectConfigComment(key, language) {
  return COMMENTS[language][key];
}
function commentKey(line, block, nativeNested) {
  const match = /^(\s*)([a-z_]+):/u.exec(line);
  if (!match) return null;
  const indent = match[1].length;
  const key = match[2];
  if (indent === 0 && key in COMMENTS.en) return key;
  if (indent === 2 && block) {
    const blockKey = `${block}.${key}`;
    if (blockKey in COMMENTS.en) return blockKey;
  }
  if (indent === 4 && block === "native" && nativeNested === "snapshot") {
    const nestedKey = `native.snapshot.${key}`;
    if (nestedKey in COMMENTS.en) return nestedKey;
  }
  return null;
}
function renderStructuredProjectConfig(value, language) {
  const output = [];
  let block = null;
  let nativeNested = null;
  for (const line of (0, import_yaml.stringify)(value).trimEnd().split("\n")) {
    const key = commentKey(line, block, nativeNested);
    if (key) {
      const indent = line.match(/^\s*/u)?.[0] ?? "";
      for (const comment of projectConfigComment(key, language).split("\n")) {
        output.push(`${indent}${comment}`);
      }
    }
    output.push(line);
    if (/^[a-z_]+:/u.test(line)) {
      if (line.startsWith("native:")) block = "native";
      else if (line.startsWith("classic:")) block = "classic";
      else block = null;
      nativeNested = null;
    } else if (/^ {2}[a-z_]+:/u.test(line) && block === "native") {
      nativeNested = line.startsWith("  snapshot:") ? "snapshot" : null;
    }
  }
  output.push("");
  return output.join("\n");
}
function projectRelativeSegments(value, label) {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0 || path.posix.isAbsolute(trimmed) || path.win32.isAbsolute(trimmed) || /^(?:~|[\\/])/u.test(trimmed)) {
    throw new Error(`${label} must be a project-relative path`);
  }
  if (trimmed === ".") return [];
  const segments = trimmed.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new Error(`${label} must stay inside the project root`);
  }
  if (segments.some((segment) => segment === "" || segment === ".")) {
    throw new Error(`${label} must not contain empty or dot path segments`);
  }
  return segments;
}
function normalizeWorkflowArtifactRoot(value) {
  const segments = projectRelativeSegments(value, "native.artifact_root");
  return segments.length === 0 ? "." : segments.join("/");
}
function normalizeClassicArtifactLayout(value, fallback = "docs") {
  const resolved = value ?? fallback;
  if (resolved !== "legacy" && resolved !== "docs") {
    throw new Error("classic.artifact_layout must be legacy or docs");
  }
  return resolved;
}
function normalizeWorkflowRelativePath(value, label, allowWildcards = false) {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const trimmed = value.trim().replaceAll("\\", "/");
  if (trimmed.length === 0 || path.posix.isAbsolute(trimmed) || path.win32.isAbsolute(trimmed) || /^(?:~|[\\/])/u.test(trimmed)) {
    throw new Error(`${label} must be relative to its declared path base`);
  }
  const segments = trimmed.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new Error(`${label} must stay inside its declared path base`);
  }
  if (segments.some((segment) => segment === "" || segment === ".")) {
    throw new Error(`${label} must not contain empty or dot path segments`);
  }
  if (!allowWildcards && /[*?]/u.test(trimmed)) {
    throw new Error(`${label} cannot contain wildcards`);
  }
  return segments.join("/");
}
function projectConfigRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  return value;
}
function projectConfigLanguage(value, fallback, label) {
  const resolved = value ?? fallback;
  if (resolved !== "en" && resolved !== "zh-CN") {
    throw new Error(`${label} must be en or zh-CN`);
  }
  return resolved;
}
function normalizeWorkflowSnapshotPattern(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.includes("\0") || value.startsWith("/") || value.split("/").includes("..")) {
    throw new Error(`${label} contains an unsafe pattern`);
  }
  if (value.length > MAX_WORKFLOW_SNAPSHOT_PATTERN_LENGTH) {
    throw new Error(`${label} exceeds ${MAX_WORKFLOW_SNAPSHOT_PATTERN_LENGTH} characters`);
  }
  let wildcardTokens = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "?") {
      wildcardTokens += 1;
    } else if (value[index] === "*") {
      wildcardTokens += 1;
      if (value[index + 1] === "*") index += 1;
    }
  }
  if (wildcardTokens > MAX_WORKFLOW_SNAPSHOT_PATTERN_WILDCARDS) {
    throw new Error(
      `${label} contains more than ${MAX_WORKFLOW_SNAPSHOT_PATTERN_WILDCARDS} wildcard tokens`
    );
  }
  return value;
}
function workflowSnapshotPatterns(value, label, fallback) {
  if (value === void 0) return [...fallback];
  if (!Array.isArray(value)) throw new Error(`${label} contains an unsafe pattern`);
  return [
    ...new Set(value.map((pattern) => normalizeWorkflowSnapshotPattern(pattern, label)))
  ].sort((left, right) => left.localeCompare(right, "en"));
}
function positiveWorkflowSnapshotInteger(value, fallback, label) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return resolved;
}
function normalizeWorkflowSnapshot(value) {
  if (value === void 0) {
    return {
      ...DEFAULT_WORKFLOW_NATIVE_SNAPSHOT_CONFIG,
      include: [...DEFAULT_WORKFLOW_NATIVE_SNAPSHOT_CONFIG.include],
      exclude: [...DEFAULT_WORKFLOW_NATIVE_SNAPSHOT_CONFIG.exclude]
    };
  }
  const snapshot = projectConfigRecord(value, "native.snapshot");
  return {
    include: workflowSnapshotPatterns(
      snapshot.include,
      "native.snapshot.include",
      DEFAULT_WORKFLOW_NATIVE_SNAPSHOT_CONFIG.include
    ),
    exclude: workflowSnapshotPatterns(
      snapshot.exclude,
      "native.snapshot.exclude",
      DEFAULT_WORKFLOW_NATIVE_SNAPSHOT_CONFIG.exclude
    ),
    max_files: positiveWorkflowSnapshotInteger(
      snapshot.max_files,
      DEFAULT_WORKFLOW_NATIVE_SNAPSHOT_CONFIG.max_files,
      "native.snapshot.max_files"
    ),
    max_total_bytes: positiveWorkflowSnapshotInteger(
      snapshot.max_total_bytes,
      DEFAULT_WORKFLOW_NATIVE_SNAPSHOT_CONFIG.max_total_bytes,
      "native.snapshot.max_total_bytes"
    ),
    max_duration_ms: positiveWorkflowSnapshotInteger(
      snapshot.max_duration_ms,
      DEFAULT_WORKFLOW_NATIVE_SNAPSHOT_CONFIG.max_duration_ms,
      "native.snapshot.max_duration_ms"
    )
  };
}
function normalizeWorkflowPendingRootMove(value) {
  if (value === void 0) return void 0;
  const pending = projectConfigRecord(value, "native.pending_root_move");
  const id = pending.id;
  const from = pending.from_artifact_root;
  const to = pending.to_artifact_root;
  const stage = pending.stage;
  if (typeof id !== "string" || !/^[a-f0-9-]{8,}$/u.test(id)) {
    throw new Error("native.pending_root_move.id is invalid");
  }
  if (typeof from !== "string" || typeof to !== "string") {
    throw new Error("native.pending_root_move roots must be strings");
  }
  if (stage !== "copying" && stage !== "ready" && stage !== "switched") {
    throw new Error("native.pending_root_move.stage is invalid");
  }
  let cleanup;
  if (pending.cleanup !== void 0) {
    const rawCleanup = projectConfigRecord(pending.cleanup, "native.pending_root_move.cleanup");
    const kind = rawCleanup.kind;
    const state = rawCleanup.state;
    const manifestHash2 = rawCleanup.manifest_hash;
    if (kind !== "forward-source" && kind !== "restart-staging" && kind !== "rollback-destination" && kind !== "rollback-staging") {
      throw new Error("native.pending_root_move.cleanup.kind is invalid");
    }
    if (state !== "prepared" && state !== "quarantined" && state !== "deleting") {
      throw new Error("native.pending_root_move.cleanup.state is invalid");
    }
    if (typeof manifestHash2 !== "string" || !/^[a-f0-9]{64}$/u.test(manifestHash2)) {
      throw new Error("native.pending_root_move.cleanup.manifest_hash is invalid");
    }
    cleanup = { kind, state, manifestHash: manifestHash2 };
  }
  return {
    id,
    fromArtifactRoot: normalizeWorkflowArtifactRoot(from),
    toArtifactRoot: normalizeWorkflowArtifactRoot(to),
    stage,
    ...cleanup ? { cleanup } : {}
  };
}
function normalizeWorkflowNativeProjectConfig(value) {
  const native = projectConfigRecord(value, "native");
  if (typeof native.artifact_root !== "string") {
    throw new Error("native.artifact_root must be a string");
  }
  const clarificationMode = native.clarification_mode ?? "sequential";
  if (clarificationMode !== "sequential" && clarificationMode !== "batch") {
    throw new Error("native.clarification_mode must be sequential or batch");
  }
  const archiveConfirmation = native.archive_confirmation ?? "automatic";
  if (archiveConfirmation !== "automatic" && archiveConfirmation !== "required") {
    throw new Error("native.archive_confirmation must be automatic or required");
  }
  const maxVerifyFailures = native.max_verify_failures ?? DEFAULT_WORKFLOW_NATIVE_MAX_VERIFY_FAILURES;
  if (!Number.isSafeInteger(maxVerifyFailures) || maxVerifyFailures < 1) {
    throw new Error("native.max_verify_failures must be a positive integer");
  }
  const pending = normalizeWorkflowPendingRootMove(native.pending_root_move);
  return {
    artifact_root: normalizeWorkflowArtifactRoot(native.artifact_root),
    language: projectConfigLanguage(native.language, "en", "native.language"),
    clarification_mode: clarificationMode,
    archive_confirmation: archiveConfirmation,
    max_verify_failures: maxVerifyFailures,
    snapshot: normalizeWorkflowSnapshot(native.snapshot),
    ...pending ? { pending_root_move: pending } : {}
  };
}
function normalizeWorkflowClassicProjectConfig(value) {
  const classic = projectConfigRecord(value, "classic");
  const contextCompression2 = classic.context_compression ?? "off";
  if (contextCompression2 !== "off" && contextCompression2 !== "beta") {
    throw new Error("classic.context_compression must be off or beta");
  }
  const reviewMode = classic.review_mode ?? "standard";
  if (reviewMode !== "off" && reviewMode !== "standard" && reviewMode !== "thorough") {
    throw new Error("classic.review_mode must be off, standard, or thorough");
  }
  const autoTransition2 = classic.auto_transition ?? true;
  if (typeof autoTransition2 !== "boolean") {
    throw new Error("classic.auto_transition must be true or false");
  }
  return {
    artifact_layout: normalizeClassicArtifactLayout(classic.artifact_layout),
    language: projectConfigLanguage(classic.language, "zh-CN", "classic.language"),
    context_compression: contextCompression2,
    review_mode: reviewMode,
    auto_transition: autoTransition2
  };
}
function normalizeAmbientResume(value) {
  const resolved = value ?? true;
  if (typeof resolved !== "boolean") {
    throw new Error("ambient_resume must be true or false");
  }
  return resolved;
}
function normalizeWorkflowProjectConfig(root, native, classic, ambientResume, options) {
  const hasSchema = root.schema !== void 0;
  const hasProjectMarker = hasSchema || root.default_workflow !== void 0 || root.workflows !== void 0 || !options.allowPartialProject && root.native !== void 0;
  if (!hasProjectMarker) return null;
  if (options.allowPartialProject && !hasSchema) return null;
  if (root.schema !== "comet.project.v1") {
    throw new Error("Unsupported Comet project schema");
  }
  if (root.default_workflow !== "native" && root.default_workflow !== "classic") {
    throw new Error("default_workflow must be native or classic");
  }
  const configuredWorkflows = root.workflows ?? [root.default_workflow];
  if (!Array.isArray(configuredWorkflows) || configuredWorkflows.length === 0 || configuredWorkflows.some((workflow) => workflow !== "native" && workflow !== "classic")) {
    throw new Error("workflows must contain native and/or classic");
  }
  const workflows = [...new Set(configuredWorkflows)];
  if (!workflows.includes(root.default_workflow)) {
    throw new Error("workflows must include default_workflow");
  }
  if (workflows.includes("native") && !native) {
    throw new Error("native must be a mapping");
  }
  return {
    schema: "comet.project.v1",
    default_workflow: root.default_workflow,
    workflows,
    ambient_resume: ambientResume,
    ...native ? { native } : {},
    ...classic ? { classic } : {}
  };
}
function parseWorkflowProjectConfigDocument(source, options = {}) {
  const document = (0, import_yaml.parseDocument)(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`Invalid .comet/config.yaml: ${document.errors[0].message}`);
  }
  const parsed = document.toJS();
  if (parsed === null || parsed === void 0) {
    return { value: {}, config: null, ambient_resume: true };
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid .comet/config.yaml: root must be a mapping");
  }
  const value = parsed;
  const ambientResume = normalizeAmbientResume(value.ambient_resume);
  const native = value.native === void 0 ? void 0 : normalizeWorkflowNativeProjectConfig(value.native);
  const classic = value.classic === void 0 ? void 0 : normalizeWorkflowClassicProjectConfig(value.classic);
  const config = normalizeWorkflowProjectConfig(value, native, classic, ambientResume, {
    allowPartialProject: options.allowPartialProject ?? false
  });
  return {
    value,
    config,
    ambient_resume: ambientResume,
    ...native ? { native } : {},
    ...classic ? { classic } : {}
  };
}
var import_yaml, WORKFLOW_PROJECT_CONFIG_MAX_BYTES, MAX_WORKFLOW_SNAPSHOT_PATTERN_LENGTH, MAX_WORKFLOW_SNAPSHOT_PATTERN_WILDCARDS, DEFAULT_WORKFLOW_NATIVE_MAX_VERIFY_FAILURES, DEFAULT_WORKFLOW_NATIVE_SNAPSHOT_CONFIG, COMMENTS;
var init_project_config = __esm({
  "domains/workflow-contract/project-config.ts"() {
    "use strict";
    import_yaml = __toESM(require_dist(), 1);
    WORKFLOW_PROJECT_CONFIG_MAX_BYTES = 64 * 1024;
    MAX_WORKFLOW_SNAPSHOT_PATTERN_LENGTH = 1024;
    MAX_WORKFLOW_SNAPSHOT_PATTERN_WILDCARDS = 64;
    DEFAULT_WORKFLOW_NATIVE_MAX_VERIFY_FAILURES = 5;
    DEFAULT_WORKFLOW_NATIVE_SNAPSHOT_CONFIG = {
      include: ["**/*"],
      exclude: [],
      max_files: 1e4,
      max_total_bytes: 256 * 1024 * 1024,
      max_duration_ms: 6e4
    };
    COMMENTS = {
      en: {
        schema: "# Configuration schema used by Comet. Do not edit this value.",
        default_workflow: "# Default workflow entered by /comet. Must also appear in workflows.",
        workflows: "# Workflows enabled in this project: native, classic, or both.",
        ambient_resume: "# Enables automatic recovery through the read-only Ambient Resume probe for both Native and Classic. Set false to disable it.\n# ambient_resume: true | false",
        native: "# Native workflow settings. They do not change Classic state or behavior.",
        "native.artifact_root": "# Root directory where Native stores Comet specs, changes, and runtime data.",
        "native.language": "# Artifact language used by Native workflow documents.\n# language: en | zh-CN",
        "native.clarification_mode": "# Controls whether Native asks one clarification at a time or every currently answerable question in a round.\n# clarification_mode: sequential | batch",
        "native.archive_confirmation": "# Controls whether Native archives automatically after a successful preview or waits for explicit user confirmation.\n# archive_confirmation: automatic | required",
        "native.max_verify_failures": "# Maximum failed Verify outcomes allowed for one confirmed contract before Native stops the completion loop.",
        "native.snapshot": "# Controls the auditable project scope and bounded work used by Native content snapshots.",
        "native.snapshot.include": "# Selects the project-relative paths included in Native snapshots. Patterns use / and support *, **, and ?.",
        "native.snapshot.exclude": "# Removes paths from the included scope. Exclusions are bound into each new change baseline.",
        "native.snapshot.max_files": "# Bounds the number of files captured by one snapshot. Increase it for large monorepos.",
        "native.snapshot.max_total_bytes": "# Bounds the total file content hashed by one snapshot. Content is streamed and does not depend on Git hashes.",
        "native.snapshot.max_duration_ms": "# Bounds snapshot capture time in milliseconds. Increase it together with the byte budget on slower or larger repositories.",
        classic: "# Classic workflow settings. They do not change Native state or behavior.",
        "classic.artifact_layout": "# Selects the Classic artifact layout. The default is docs; update preserves detected root-level legacy artifacts.\n# artifact_layout: legacy | docs",
        "classic.language": "# Artifact language used by Classic workflow documents.\n# language: en | zh-CN",
        "classic.context_compression": "# Controls beta context compression for new Classic changes.\n# context_compression: off | beta",
        "classic.review_mode": "# Sets the default review depth for new Classic changes.\n# review_mode: off | standard | thorough",
        "classic.auto_transition": "# Automatically enters the next Classic phase after a phase passes.\n# auto_transition: true | false"
      },
      "zh-CN": {
        schema: "# Comet 使用的配置格式版本，请勿修改此值。",
        default_workflow: "# `/comet` 默认进入的工作流；该值也必须出现在 workflows 中。",
        workflows: "# 此项目启用的工作流，可填写 native、classic 或同时启用两者。",
        ambient_resume: "# 是否启用只读的环境感知恢复探针，同时作用于 Native 和 Classic；设为 false 可关闭自动工作流恢复。\n# ambient_resume: true | false",
        native: "# Native 工作流配置，不会改变 Classic 的状态或行为。",
        "native.artifact_root": "# Native 产物的存放根目录，包括规格、change 和运行时数据。",
        "native.language": "# Native 工作流文档使用的产物语言。\n# 可选值：en | zh-CN",
        "native.clarification_mode": "# Native 每轮询问一个问题，或一次提出当前所有可回答的问题。\n# 可选值：sequential | batch",
        "native.archive_confirmation": "# Native 归档预演成功后自动归档，或等待用户明确确认。\n# 可选值：automatic | required",
        "native.max_verify_failures": "# 同一份已确认 contract 最多允许的 Verify 失败次数；达到上限后停止完成循环。",
        "native.snapshot": "# Native 内容快照使用的可审计项目范围与有界工作预算。",
        "native.snapshot.include": "# Native 快照纳入的项目相对路径；模式使用 /，支持 *、** 和 ?。",
        "native.snapshot.exclude": "# 从纳入范围中排除路径；新 change 会把排除策略绑定到 baseline。",
        "native.snapshot.max_files": "# 单次快照最多捕获的文件数；大型 monorepo 可按需提高。",
        "native.snapshot.max_total_bytes": "# 单次快照最多哈希的文件内容总字节数；内容采用流式读取，不依赖 Git hash。",
        "native.snapshot.max_duration_ms": "# 单次快照的最长执行时间（毫秒）；较慢或更大的仓库应与字节预算一并提高。",
        classic: "# Classic 工作流配置，不会改变 Native 的状态或行为。",
        "classic.artifact_layout": "# Classic 产物布局；默认使用 docs，update 检测到根目录 legacy 产物时予以保留。\n# 可选值：legacy | docs",
        "classic.language": "# Classic 工作流文档使用的产物语言。\n# 可选值：en | zh-CN",
        "classic.context_compression": "# 新建 Classic change 是否启用 beta 上下文压缩。\n# 可选值：off | beta",
        "classic.review_mode": "# 新建 Classic change 默认使用的审查深度。\n# 可选值：off | standard | thorough",
        "classic.auto_transition": "# Classic 阶段通过后是否自动进入下一阶段。\n# 可选值：true | false"
      }
    };
  }
});

// platform/fs/file-identity.ts
function hasPlatformIdentity(value) {
  return value !== 0 && value !== 0n && value !== "0";
}
function hasComparableFileObject(left, right) {
  return hasPlatformIdentity(left.dev) && hasPlatformIdentity(right.dev) && hasPlatformIdentity(left.ino) && hasPlatformIdentity(right.ino);
}
function sameFileObject(left, right) {
  const comparableDevice = hasPlatformIdentity(left.dev) && hasPlatformIdentity(right.dev);
  if (comparableDevice && left.dev !== right.dev) return false;
  const comparableInode = hasPlatformIdentity(left.ino) && hasPlatformIdentity(right.ino);
  if (comparableInode && left.ino !== right.ino) return false;
  if (comparableDevice && comparableInode) return true;
  return left.birthtime === right.birthtime;
}
var init_file_identity = __esm({
  "platform/fs/file-identity.ts"() {
    "use strict";
  }
});

// platform/fs/race-safe-read.ts
import { constants as fsConstants, promises as fs2 } from "fs";
function birthtimeOf(stat) {
  return "birthtimeNs" in stat && typeof stat.birthtimeNs === "bigint" ? stat.birthtimeNs : stat.birthtimeMs;
}
function ctimeOf(stat) {
  return "ctimeNs" in stat && typeof stat.ctimeNs === "bigint" ? stat.ctimeNs : stat.ctimeMs;
}
function identityOf(stat) {
  return { dev: stat.dev, ino: stat.ino, birthtime: birthtimeOf(stat) };
}
function sameStatIdentity(left, right) {
  const leftObject = identityOf(left);
  const rightObject = identityOf(right);
  if (hasComparableFileObject(leftObject, rightObject)) {
    return sameFileObject(leftObject, rightObject);
  }
  return sameFileObject(leftObject, rightObject) && birthtimeOf(left) === birthtimeOf(right) && ctimeOf(left) === ctimeOf(right) && left.size === right.size;
}
async function readFileRaceSafe(file, maxBytes, options = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("race-safe read byte limit must be a positive integer");
  }
  const label = options.label ?? "file";
  const bigint = options.bigint === true;
  const before = await fs2.lstat(file, { bigint });
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new RaceSafeReadError("not-regular-file", `${label} must be a regular file`);
  }
  if (BigInt(before.size) > BigInt(maxBytes)) {
    throw new RaceSafeReadError("too-large", `${label} exceeds ${maxBytes} bytes`);
  }
  const beforeRealPath = await fs2.realpath(file);
  await options.verify?.("pre-open", { realPath: beforeRealPath, identity: identityOf(before) });
  const flags = process.platform === "win32" ? fsConstants.O_RDONLY : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;
  let handle;
  try {
    handle = await fs2.open(file, flags);
  } catch (error) {
    if (error.code === "ELOOP") {
      throw new RaceSafeReadError("not-regular-file", `${label} must be a regular file`, {
        cause: error
      });
    }
    throw error;
  }
  try {
    const [opened, pathAfterOpen, realPathAfterOpen] = await Promise.all([
      handle.stat({ bigint }),
      fs2.lstat(file, { bigint }),
      fs2.realpath(file)
    ]);
    if (!opened.isFile() || !pathAfterOpen.isFile() || pathAfterOpen.isSymbolicLink() || realPathAfterOpen !== beforeRealPath || !sameStatIdentity(before, opened) || !sameStatIdentity(before, pathAfterOpen)) {
      throw new RaceSafeReadError("changed", `${label} changed while opening`);
    }
    await options.verify?.("post-open", {
      realPath: realPathAfterOpen,
      identity: identityOf(opened)
    });
    await options.hooks?.afterOpen?.();
    const chunks = [];
    let total = 0;
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1));
    for (; ; ) {
      const remaining = maxBytes + 1 - total;
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, remaining), null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) {
        throw new RaceSafeReadError("too-large", `${label} exceeds ${maxBytes} bytes`);
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    await options.hooks?.beforeFinalCheck?.();
    const [afterHandle, afterPath, afterRealPath] = await Promise.all([
      handle.stat({ bigint }),
      fs2.lstat(file, { bigint }),
      fs2.realpath(file)
    ]);
    if (!afterPath.isFile() || afterPath.isSymbolicLink() || afterRealPath !== beforeRealPath || !sameStatIdentity(before, afterHandle) || !sameStatIdentity(before, afterPath)) {
      throw new RaceSafeReadError("changed", `${label} changed while reading`);
    }
    await options.verify?.("post-read", {
      realPath: afterRealPath,
      identity: identityOf(afterHandle)
    });
    return { bytes: Buffer.concat(chunks, total), stat: afterHandle, realPath: afterRealPath };
  } finally {
    await handle.close();
  }
}
var RaceSafeReadError;
var init_race_safe_read = __esm({
  "platform/fs/race-safe-read.ts"() {
    "use strict";
    init_file_identity();
    RaceSafeReadError = class extends Error {
      reason;
      constructor(reason, message, options) {
        super(message, options);
        this.name = "RaceSafeReadError";
        this.reason = reason;
      }
    };
  }
});

// domains/workflow-contract/protected-project-path.ts
import { promises as fs3 } from "fs";
import path2 from "path";
function isMissingPath(error) {
  const code = error?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}
function isInside(root, target) {
  const relative = path2.relative(root, target);
  return relative === "" || !path2.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path2.sep}`);
}
async function assertRealProjectRoot(projectRoot, label) {
  const lexicalRoot = path2.resolve(projectRoot);
  const stat = await fs3.lstat(lexicalRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} project root must be a real directory`);
  }
  return fs3.realpath(lexicalRoot);
}
async function inspectExistingChain(lexicalRoot, realRoot, segments, options) {
  let cursor = lexicalRoot;
  for (let index = 0; index < segments.length; index++) {
    cursor = path2.join(cursor, segments[index]);
    let stat;
    try {
      stat = await fs3.lstat(cursor);
    } catch (error) {
      if (isMissingPath(error)) return { exists: false, kind: "missing" };
      throw error;
    }
    const display = path2.relative(lexicalRoot, cursor).replaceAll("\\", "/");
    if (stat.isSymbolicLink()) {
      throw new Error(`${options.label} crosses a symbolic link or junction at ${display}`);
    }
    const final = index === segments.length - 1;
    if (!final && !stat.isDirectory()) {
      throw new Error(`${options.label} ancestor ${display} must be a real directory`);
    }
    if (final && (options.expected === "file" && !stat.isFile() || options.expected === "directory" && !stat.isDirectory() || options.expected === "any" && !stat.isFile() && !stat.isDirectory())) {
      throw new Error(`${options.label} must be a real ${options.expected}`);
    }
    const realCursor = await fs3.realpath(cursor);
    if (!isInside(realRoot, realCursor)) {
      throw new Error(`${options.label} resolves outside the project root`);
    }
    if (final) {
      return {
        exists: true,
        kind: stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "missing"
      };
    }
  }
  return { exists: true, kind: "directory" };
}
async function inspectProtectedProjectPath(projectRoot, relativePath2, options) {
  const relative = normalizeWorkflowRelativePath(relativePath2, options.label);
  const lexicalRoot = path2.resolve(projectRoot);
  const realRoot = await assertRealProjectRoot(lexicalRoot, options.label);
  const segments = relative.split("/");
  const target = path2.resolve(lexicalRoot, ...segments);
  if (!isInside(lexicalRoot, target)) {
    throw new Error(`${options.label} must stay inside the project root`);
  }
  const result5 = await inspectExistingChain(lexicalRoot, realRoot, segments, options);
  return {
    projectRoot: lexicalRoot,
    target,
    relative,
    exists: result5.exists,
    kind: result5.kind
  };
}
async function ensureProtectedProjectDirectory(projectRoot, relativePath2, options) {
  const relative = normalizeWorkflowRelativePath(relativePath2, options.label);
  const lexicalRoot = path2.resolve(projectRoot);
  const realRoot = await assertRealProjectRoot(lexicalRoot, options.label);
  const segments = relative.split("/");
  let cursor = lexicalRoot;
  for (const segment of segments) {
    cursor = path2.join(cursor, segment);
    let stat;
    try {
      stat = await fs3.lstat(cursor);
    } catch (error) {
      if (!isMissingPath(error)) throw error;
      try {
        await fs3.mkdir(cursor);
      } catch (mkdirError) {
        if (mkdirError.code !== "EEXIST") throw mkdirError;
      }
      stat = await fs3.lstat(cursor);
    }
    const display = path2.relative(lexicalRoot, cursor).replaceAll("\\", "/");
    if (stat.isSymbolicLink()) {
      throw new Error(`${options.label} crosses a symbolic link or junction at ${display}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`${options.label} directory ${display} must be a real directory`);
    }
    const realCursor = await fs3.realpath(cursor);
    if (!isInside(realRoot, realCursor)) {
      throw new Error(`${options.label} resolves outside the project root`);
    }
  }
  await inspectExistingChain(lexicalRoot, realRoot, segments, {
    label: options.label,
    expected: "directory"
  });
  return cursor;
}
async function protectedProjectFileExists(projectRoot, relativePath2, options) {
  return (await inspectProtectedProjectPath(projectRoot, relativePath2, {
    ...options,
    expected: "file"
  })).exists;
}
async function readProtectedProjectFile(projectRoot, relativePath2, maxBytes, options) {
  const inspection = await inspectProtectedProjectPath(projectRoot, relativePath2, {
    label: options.label,
    expected: "file"
  });
  if (!inspection.exists) {
    const error = new Error(`${options.label} does not exist`);
    error.code = "ENOENT";
    throw error;
  }
  const realRoot = await assertRealProjectRoot(inspection.projectRoot, options.label);
  return readFileRaceSafe(inspection.target, maxBytes, {
    ...options,
    verify: async (_checkpoint, context) => {
      if (!isInside(realRoot, context.realPath)) {
        throw new Error(`${options.label} resolves outside the project root`);
      }
      await inspectExistingChain(inspection.projectRoot, realRoot, inspection.relative.split("/"), {
        label: options.label,
        expected: "file"
      });
    }
  });
}
var init_protected_project_path = __esm({
  "domains/workflow-contract/protected-project-path.ts"() {
    "use strict";
    init_race_safe_read();
    init_project_config();
  }
});

// domains/workflow-contract/project-config-reader.ts
import { createHash } from "crypto";
function workflowProjectConfigIdentityEquals(left, right) {
  return left.exists === right.exists && left.sha256 === right.sha256;
}
function isMissingProjectConfig(error) {
  const code = error?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}
async function readWorkflowProjectConfigDocument(projectRoot, options = {}) {
  return (await readWorkflowProjectConfigSnapshot(projectRoot, options)).document;
}
async function readWorkflowProjectConfigBytes(projectRoot) {
  try {
    return (await readProtectedProjectFile(
      projectRoot,
      WORKFLOW_PROJECT_CONFIG_PATH,
      WORKFLOW_PROJECT_CONFIG_MAX_BYTES,
      { label: WORKFLOW_PROJECT_CONFIG_PATH }
    )).bytes;
  } catch (error) {
    if (isMissingProjectConfig(error)) return null;
    throw error;
  }
}
function projectConfigIdentity(bytes) {
  return bytes ? {
    exists: true,
    sha256: createHash("sha256").update(bytes).digest("hex")
  } : { exists: false, sha256: null };
}
async function readWorkflowProjectConfigIdentity(projectRoot) {
  return projectConfigIdentity(await readWorkflowProjectConfigBytes(projectRoot));
}
async function readWorkflowProjectConfigSnapshot(projectRoot, options = {}) {
  const bytes = await readWorkflowProjectConfigBytes(projectRoot);
  return {
    document: bytes ? parseWorkflowProjectConfigDocument(bytes.toString("utf8"), options) : null,
    identity: projectConfigIdentity(bytes)
  };
}
async function readWorkflowProjectConfig(projectRoot) {
  return (await readWorkflowProjectConfigDocument(projectRoot))?.config ?? null;
}
var WORKFLOW_PROJECT_CONFIG_PATH;
var init_project_config_reader = __esm({
  "domains/workflow-contract/project-config-reader.ts"() {
    "use strict";
    init_project_config();
    init_protected_project_path();
    WORKFLOW_PROJECT_CONFIG_PATH = ".comet/config.yaml";
  }
});

// domains/workflow-contract/contained-atomic-write.ts
import { randomUUID } from "crypto";
import { promises as fs4 } from "fs";
import path3 from "path";
function isInside2(parent, target) {
  const relative = path3.relative(parent, target);
  return relative === "" || !path3.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path3.sep}`);
}
function statsIdentity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    birthtime: stat.birthtimeMs
  };
}
function sameDirectoryIdentity(identity, stat) {
  return sameFileObject(identity, statsIdentity(stat));
}
function sameFileIdentity(left, right) {
  const leftIdentity = statsIdentity(left);
  const rightIdentity = statsIdentity(right);
  if (hasComparableFileObject(leftIdentity, rightIdentity)) {
    return sameFileObject(leftIdentity, rightIdentity);
  }
  return sameFileObject(leftIdentity, rightIdentity) && left.birthtimeMs === right.birthtimeMs && left.ctimeMs === right.ctimeMs && left.size === right.size;
}
async function captureDirectoryIdentity(directory) {
  const stat = await fs4.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Contained atomic write parent must be a real directory: ${directory}`);
  }
  return {
    path: directory,
    realPath: await fs4.realpath(directory),
    ...statsIdentity(stat)
  };
}
async function verifyDirectoryChain(chain) {
  for (const identity of chain) {
    const stat = await fs4.lstat(identity.path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !sameDirectoryIdentity(identity, stat) || await fs4.realpath(identity.path) !== identity.realPath) {
      throw new Error(`Contained atomic write parent changed before commit: ${identity.path}`);
    }
  }
}
async function prepareContainedDirectoryChain(root, directory) {
  const lexicalRoot = path3.resolve(root);
  const lexicalDirectory = path3.resolve(directory);
  if (!isInside2(lexicalRoot, lexicalDirectory)) {
    throw new Error(`Contained atomic write parent is outside its managed root: ${directory}`);
  }
  const chain = [await captureDirectoryIdentity(lexicalRoot)];
  const segments = path3.relative(lexicalRoot, lexicalDirectory).split(path3.sep).filter(Boolean);
  let cursor = lexicalRoot;
  for (const segment of segments) {
    await verifyDirectoryChain(chain);
    cursor = path3.join(cursor, segment);
    try {
      await fs4.mkdir(cursor);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const identity = await captureDirectoryIdentity(cursor);
    if (!isInside2(chain[0].realPath, identity.realPath)) {
      throw new Error(`Contained atomic write parent resolves outside its managed root: ${cursor}`);
    }
    chain.push(identity);
  }
  await verifyDirectoryChain(chain);
  return chain;
}
async function captureExistingContainedDirectoryChain(root, directory) {
  const lexicalRoot = path3.resolve(root);
  const lexicalDirectory = path3.resolve(directory);
  if (!isInside2(lexicalRoot, lexicalDirectory)) {
    throw new Error(`Contained file parent is outside its managed root: ${directory}`);
  }
  const chain = [await captureDirectoryIdentity(lexicalRoot)];
  const segments = path3.relative(lexicalRoot, lexicalDirectory).split(path3.sep).filter(Boolean);
  let cursor = lexicalRoot;
  for (const segment of segments) {
    cursor = path3.join(cursor, segment);
    try {
      const identity = await captureDirectoryIdentity(cursor);
      if (!isInside2(chain[0].realPath, identity.realPath)) {
        throw new Error(`Contained file parent resolves outside its managed root: ${cursor}`);
      }
      chain.push(identity);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  await verifyDirectoryChain(chain);
  return chain;
}
async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs4.open(directory, "r");
    await handle.sync();
  } catch (error) {
    const code = error.code;
    if (!["EACCES", "EBADF", "EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(code ?? "")) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}
async function atomicWriteContained(file, content, options) {
  const directory = path3.dirname(file);
  const directoryChain = await prepareContainedDirectoryChain(options.containedRoot, directory);
  const temporary = path3.join(directory, `.${path3.basename(file)}.${randomUUID()}.tmp`);
  let handle;
  let temporaryIdentity;
  try {
    await options.beforeTemporaryOpen?.();
    handle = await fs4.open(temporary, "wx");
    temporaryIdentity = await handle.stat();
    const [temporaryPathStat, temporaryRealPath] = await Promise.all([
      fs4.lstat(temporary),
      fs4.realpath(temporary)
    ]);
    await verifyDirectoryChain(directoryChain);
    if (!temporaryPathStat.isFile() || temporaryPathStat.isSymbolicLink() || !sameFileIdentity(temporaryIdentity, temporaryPathStat) || !isInside2(directoryChain[0].realPath, temporaryRealPath)) {
      throw new Error("Contained atomic write temporary file opened outside its managed parent");
    }
    if (typeof content === "string") await handle.writeFile(content, "utf8");
    else await handle.writeFile(content);
    await handle.sync();
    if (!sameFileIdentity(temporaryIdentity, await handle.stat())) {
      throw new Error("Contained atomic write temporary file changed while writing");
    }
    await handle.close();
    handle = void 0;
    await options.beforeCommit?.();
    await verifyDirectoryChain(directoryChain);
    const temporaryStat = await fs4.lstat(temporary);
    if (!temporaryStat.isFile() || temporaryStat.isSymbolicLink() || !sameFileIdentity(temporaryStat, temporaryIdentity)) {
      throw new Error("Contained atomic write temporary file changed before commit");
    }
    if (options.exclusive) {
      await fs4.link(temporary, file);
      await fs4.unlink(temporary);
    } else {
      await fs4.rename(temporary, file);
    }
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close();
    try {
      await verifyDirectoryChain(directoryChain);
      await fs4.rm(temporary, { force: true });
    } catch {
    }
    throw error;
  }
}
async function atomicWriteContainedText(file, content, options) {
  await atomicWriteContained(file, content, options);
}
async function removeContainedFile(file, options) {
  const directory = path3.dirname(file);
  const directoryChain = await captureExistingContainedDirectoryChain(
    options.containedRoot,
    directory
  );
  if (!directoryChain) return false;
  let identity;
  let realPath;
  try {
    identity = await fs4.lstat(file);
    realPath = await fs4.realpath(file);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  if (!identity.isFile() || identity.isSymbolicLink() || !isInside2(directoryChain[0].realPath, realPath)) {
    throw new Error("Contained file removal target must be a regular file inside its managed root");
  }
  await options.beforeRemove?.();
  await verifyDirectoryChain(directoryChain);
  const [current, currentRealPath] = await Promise.all([fs4.lstat(file), fs4.realpath(file)]);
  if (!current.isFile() || current.isSymbolicLink() || !sameFileIdentity(identity, current) || currentRealPath !== realPath) {
    throw new Error("Contained file removal target changed before removal");
  }
  await fs4.unlink(file);
  await verifyDirectoryChain(directoryChain);
  await syncDirectory(directory);
  return true;
}
var init_contained_atomic_write = __esm({
  "domains/workflow-contract/contained-atomic-write.ts"() {
    "use strict";
    init_file_identity();
  }
});

// domains/workflow-contract/project-config-transaction.ts
import { createHash as createHash2, randomUUID as randomUUID2 } from "crypto";
import { promises as fs5 } from "fs";
function transactionCandidate(id) {
  return `.comet/config.yaml.${id}.next`;
}
function transactionQuarantine(id) {
  return `.comet/config.yaml.${id}.quarantine`;
}
function transactionCleanup(id) {
  return `.comet/config-write-transaction.${id}.cleanup`;
}
function sha256(bytes) {
  return createHash2("sha256").update(bytes).digest("hex");
}
function isMissing(error) {
  const code = error?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}
async function readTransaction(projectRoot) {
  let bytes;
  try {
    bytes = (await readProtectedProjectFile(
      projectRoot,
      CONFIG_TRANSACTION_PATH,
      CONFIG_TRANSACTION_MAX_BYTES,
      { label: "project config write transaction" }
    )).bytes;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Invalid project config write transaction: expected JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid project config write transaction: expected an object");
  }
  const record2 = value;
  const keys = Object.keys(record2).sort();
  const expectedKeys = [
    "candidate",
    "expected_sha256",
    "id",
    "output_sha256",
    "owner_pid",
    "quarantine",
    "schema"
  ].sort();
  if (keys.join("\n") !== expectedKeys.join("\n")) {
    throw new Error("Invalid project config write transaction: unexpected fields");
  }
  if (record2.schema !== CONFIG_TRANSACTION_SCHEMA) {
    throw new Error("Invalid project config write transaction: unsupported schema");
  }
  if (typeof record2.id !== "string" || !UUID_PATTERN.test(record2.id)) {
    throw new Error("Invalid project config write transaction: invalid id");
  }
  if (typeof record2.owner_pid !== "number" || !Number.isSafeInteger(record2.owner_pid) || record2.owner_pid <= 0) {
    throw new Error("Invalid project config write transaction: invalid owner pid");
  }
  if (typeof record2.expected_sha256 !== "string" || !SHA256_PATTERN.test(record2.expected_sha256) || typeof record2.output_sha256 !== "string" || !SHA256_PATTERN.test(record2.output_sha256)) {
    throw new Error("Invalid project config write transaction: invalid config hash");
  }
  if (record2.candidate !== transactionCandidate(record2.id) || record2.quarantine !== transactionQuarantine(record2.id)) {
    throw new Error("Invalid project config write transaction: paths do not match its id");
  }
  return {
    journal: record2,
    source: bytes.toString("utf8")
  };
}
async function readOwnedFileHash(projectRoot, relativePath2) {
  try {
    const { bytes } = await readProtectedProjectFile(
      projectRoot,
      relativePath2,
      CONFIG_TRANSACTION_MAX_BYTES,
      { label: relativePath2 }
    );
    return sha256(bytes);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}
async function removeOwnedFile(projectRoot, relativePath2, expectedHash, afterQuarantine) {
  const canonical = await inspectProtectedProjectPath(projectRoot, relativePath2, {
    label: relativePath2,
    expected: "file"
  });
  if (!canonical.exists) return false;
  const cleanupRelative = `${relativePath2}.${randomUUID2()}.cleanup`;
  const cleanup = await inspectProtectedProjectPath(projectRoot, cleanupRelative, {
    label: `${relativePath2} cleanup`,
    expected: "file"
  });
  if (cleanup.exists) throw new Error(`Owned cleanup path already exists: ${cleanupRelative}`);
  await fs5.rename(canonical.target, cleanup.target);
  await afterQuarantine?.(relativePath2, cleanupRelative);
  const actualHash = await readOwnedFileHash(projectRoot, cleanupRelative);
  if (actualHash !== expectedHash) {
    try {
      const successor = await inspectProtectedProjectPath(projectRoot, relativePath2, {
        label: relativePath2,
        expected: "file"
      });
      if (!successor.exists) {
        await fs5.link(cleanup.target, successor.target);
        await fs5.unlink(cleanup.target);
      }
    } catch {
    }
    throw new Error(`Refusing to remove modified project config transaction file: ${relativePath2}`);
  }
  await fs5.unlink(cleanup.target);
  return true;
}
function processIsAlive(pid) {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}
async function removeTransactionJournal(projectRoot, transaction) {
  const cleanupRelative = transactionCleanup(transaction.journal.id);
  const cleanup = await inspectProtectedProjectPath(projectRoot, cleanupRelative, {
    label: "project config write transaction cleanup",
    expected: "file"
  });
  if (cleanup.exists) {
    throw new Error("Project config write transaction cleanup path already exists");
  }
  const canonical = await inspectProtectedProjectPath(projectRoot, CONFIG_TRANSACTION_PATH, {
    label: "project config write transaction",
    expected: "file"
  });
  if (!canonical.exists) {
    throw new Error("Project config write transaction changed before cleanup");
  }
  await fs5.rename(canonical.target, cleanup.target);
  const displaced = await readProtectedProjectFile(
    projectRoot,
    cleanupRelative,
    CONFIG_TRANSACTION_MAX_BYTES,
    { label: "project config write transaction cleanup" }
  );
  if (sha256(displaced.bytes) !== sha256(transaction.source)) {
    try {
      const successor = await inspectProtectedProjectPath(projectRoot, CONFIG_TRANSACTION_PATH, {
        label: "project config write transaction",
        expected: "file"
      });
      if (!successor.exists) await fs5.link(cleanup.target, successor.target);
    } catch {
    }
    throw new Error("Project config write transaction changed before cleanup");
  }
  await fs5.unlink(cleanup.target);
}
async function beginWorkflowProjectConfigTransaction(projectRoot, id, expectedSha256, outputSha256) {
  if (!UUID_PATTERN.test(id)) throw new Error("Invalid project config write transaction id");
  if (!SHA256_PATTERN.test(expectedSha256) || !SHA256_PATTERN.test(outputSha256)) {
    throw new Error("Invalid project config write transaction hash");
  }
  if (await readTransaction(projectRoot)) {
    throw new Error(
      "An unfinished project config write transaction exists; run comet doctor --repair"
    );
  }
  const journal = {
    schema: CONFIG_TRANSACTION_SCHEMA,
    id,
    owner_pid: process.pid,
    expected_sha256: expectedSha256,
    output_sha256: outputSha256,
    candidate: transactionCandidate(id),
    quarantine: transactionQuarantine(id)
  };
  await atomicWriteContainedText(
    (await inspectProtectedProjectPath(projectRoot, CONFIG_TRANSACTION_PATH, {
      label: "project config write transaction",
      expected: "file"
    })).target,
    `${JSON.stringify(journal, null, 2)}
`,
    { containedRoot: projectRoot, exclusive: true }
  );
  return { candidate: journal.candidate, quarantine: journal.quarantine };
}
async function inspectWorkflowProjectConfigTransaction(projectRoot) {
  const transaction = await readTransaction(projectRoot);
  if (!transaction) return null;
  const { journal } = transaction;
  const [config, candidateHash, quarantineHash] = await Promise.all([
    readWorkflowProjectConfigIdentity(projectRoot),
    readOwnedFileHash(projectRoot, journal.candidate),
    readOwnedFileHash(projectRoot, journal.quarantine)
  ]);
  if (candidateHash !== null && candidateHash !== journal.output_sha256) {
    throw new Error("Project config write transaction candidate changed after creation");
  }
  if (quarantineHash !== null && quarantineHash !== journal.expected_sha256) {
    throw new Error("Project config write transaction quarantine changed after creation");
  }
  let stage;
  if (!config.exists && quarantineHash === journal.expected_sha256) {
    stage = "config-quarantined";
  } else if (config.sha256 === journal.output_sha256) {
    stage = "published-cleanup-pending";
  } else if (config.exists && config.sha256 !== journal.expected_sha256 && config.sha256 !== journal.output_sha256) {
    stage = "successor-preserved-cleanup-pending";
  } else {
    stage = "prepared";
  }
  return {
    id: journal.id,
    stage,
    candidate: journal.candidate,
    quarantine: journal.quarantine,
    allowedRepair: "rollback-or-cleanup"
  };
}
async function repairWorkflowProjectConfigTransaction(projectRoot, options = {}) {
  const transaction = await readTransaction(projectRoot);
  if (!transaction) return false;
  const { journal } = transaction;
  if (options.ownerId !== journal.id && processIsAlive(journal.owner_pid)) {
    throw new Error(
      `Project config write transaction ${journal.id} is still active in process ${journal.owner_pid}`
    );
  }
  const inspection = await inspectWorkflowProjectConfigTransaction(projectRoot);
  if (!inspection) return false;
  let config = await readWorkflowProjectConfigIdentity(projectRoot);
  const quarantineHash = await readOwnedFileHash(projectRoot, journal.quarantine);
  if (!config.exists) {
    if (quarantineHash !== journal.expected_sha256) {
      throw new Error(
        "Cannot recover project config write transaction: the config and owned quarantine are missing"
      );
    }
    const canonical = await inspectProtectedProjectPath(projectRoot, WORKFLOW_PROJECT_CONFIG_PATH, {
      label: WORKFLOW_PROJECT_CONFIG_PATH,
      expected: "file"
    });
    const quarantine = await inspectProtectedProjectPath(projectRoot, journal.quarantine, {
      label: "project config write transaction quarantine",
      expected: "file"
    });
    try {
      await fs5.link(quarantine.target, canonical.target);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    config = await readWorkflowProjectConfigIdentity(projectRoot);
    if (!config.exists) {
      throw new Error("Cannot recover project config write transaction: config publish failed");
    }
  }
  await removeOwnedFile(
    projectRoot,
    journal.candidate,
    journal.output_sha256,
    options.testHooks?.afterOwnedFileQuarantine
  );
  if (config.exists) {
    await removeOwnedFile(
      projectRoot,
      journal.quarantine,
      journal.expected_sha256,
      options.testHooks?.afterOwnedFileQuarantine
    );
  }
  await removeTransactionJournal(projectRoot, transaction);
  return true;
}
var CONFIG_TRANSACTION_SCHEMA, CONFIG_TRANSACTION_PATH, CONFIG_TRANSACTION_MAX_BYTES, UUID_PATTERN, SHA256_PATTERN;
var init_project_config_transaction = __esm({
  "domains/workflow-contract/project-config-transaction.ts"() {
    "use strict";
    init_contained_atomic_write();
    init_project_config_reader();
    init_protected_project_path();
    CONFIG_TRANSACTION_SCHEMA = "comet.project-config-write.v1";
    CONFIG_TRANSACTION_PATH = ".comet/config-write-transaction.json";
    CONFIG_TRANSACTION_MAX_BYTES = 16 * 1024;
    UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    SHA256_PATTERN = /^[0-9a-f]{64}$/;
  }
});

// domains/workflow-contract/project-config-writer.ts
import { createHash as createHash3, randomUUID as randomUUID3 } from "crypto";
import { promises as fs6 } from "fs";
import path4 from "path";
async function assertWorkflowProjectConfigIdentity(projectRoot, expectedIdentity) {
  if (!expectedIdentity) return;
  const current = await readWorkflowProjectConfigIdentity(projectRoot);
  if (!workflowProjectConfigIdentityEquals(current, expectedIdentity)) {
    throw new Error("Project config changed before commit; rerun the operation");
  }
}
async function writeWorkflowProjectConfigSource(projectRoot, output, options = {}) {
  parseWorkflowProjectConfigDocument(output, {
    allowPartialProject: options.allowPartialProject ?? false
  });
  const root = path4.resolve(projectRoot);
  if (await inspectWorkflowProjectConfigTransaction(root)) {
    throw new Error(
      "An unfinished project config write transaction exists; run comet doctor --repair"
    );
  }
  const expectedIdentity = options.expectedIdentity ?? await readWorkflowProjectConfigIdentity(root);
  await assertWorkflowProjectConfigIdentity(root, expectedIdentity);
  const finalInspection = await inspectProtectedProjectPath(root, WORKFLOW_PROJECT_CONFIG_PATH, {
    label: WORKFLOW_PROJECT_CONFIG_PATH,
    expected: "file"
  });
  const transactionId = randomUUID3();
  const expectedOutputHash = createHash3("sha256").update(output).digest("hex");
  const transactionPaths2 = expectedIdentity.exists && expectedIdentity.sha256 ? await beginWorkflowProjectConfigTransaction(
    root,
    transactionId,
    expectedIdentity.sha256,
    expectedOutputHash
  ) : null;
  let transactionOpen = transactionPaths2 !== null;
  const temporaryRelative = transactionPaths2?.candidate ?? `.comet/config.yaml.${transactionId}.next`;
  const temporary = path4.join(root, ...temporaryRelative.split("/"));
  const quarantineRelative = transactionPaths2?.quarantine ?? null;
  try {
    await atomicWriteContainedText(temporary, output, {
      containedRoot: root,
      exclusive: true
    });
    await options.beforeCommit?.();
    await assertWorkflowProjectConfigIdentity(root, expectedIdentity);
    await inspectProtectedProjectPath(root, temporaryRelative, {
      label: "project config candidate",
      expected: "file"
    });
    if (expectedIdentity.exists) {
      if (!quarantineRelative) {
        throw new Error("Project config write transaction was not created");
      }
      const quarantine = path4.join(root, ...quarantineRelative.split("/"));
      await inspectProtectedProjectPath(root, WORKFLOW_PROJECT_CONFIG_PATH, {
        label: WORKFLOW_PROJECT_CONFIG_PATH,
        expected: "file"
      });
      const quarantineInspection = await inspectProtectedProjectPath(root, quarantineRelative, {
        label: "project config quarantine",
        expected: "file"
      });
      if (quarantineInspection.exists) {
        throw new Error("Project config quarantine already exists");
      }
      await fs6.rename(finalInspection.target, quarantine);
      const { bytes } = await readProtectedProjectFile(
        root,
        quarantineRelative,
        WORKFLOW_PROJECT_CONFIG_MAX_BYTES,
        { label: "project config quarantine" }
      );
      const quarantinedHash = createHash3("sha256").update(bytes).digest("hex");
      if (quarantinedHash !== expectedIdentity.sha256) {
        throw new Error("Project config changed before final publish; successor was preserved");
      }
    } else if (finalInspection.exists) {
      throw new Error("Project config changed before final publish; successor was preserved");
    }
    await options.beforePublish?.();
    await inspectProtectedProjectPath(root, temporaryRelative, {
      label: "project config candidate",
      expected: "file"
    });
    try {
      await fs6.link(temporary, finalInspection.target);
    } catch (error) {
      throw new Error("Project config final publish failed; successor was preserved", {
        cause: error
      });
    }
    const published = await readWorkflowProjectConfigIdentity(root);
    if (!published.exists || published.sha256 !== expectedOutputHash) {
      throw new Error("Project config changed during final publish; successor was preserved");
    }
    if (transactionOpen) {
      await repairWorkflowProjectConfigTransaction(root, { ownerId: transactionId });
      transactionOpen = false;
    }
  } catch (error) {
    if (transactionOpen) {
      try {
        if (await repairWorkflowProjectConfigTransaction(root, { ownerId: transactionId })) {
          transactionOpen = false;
        }
      } catch {
      }
    }
    throw error;
  } finally {
    if (!transactionOpen) {
      await removeProtectedConfigFile(root, temporaryRelative).catch(() => false);
    }
  }
}
async function removeProtectedConfigFile(projectRoot, relativePath2) {
  const inspection = await inspectProtectedProjectPath(projectRoot, relativePath2, {
    label: relativePath2,
    expected: "file"
  });
  if (!inspection.exists) return false;
  await fs6.unlink(inspection.target);
  return true;
}
var init_project_config_writer = __esm({
  "domains/workflow-contract/project-config-writer.ts"() {
    "use strict";
    init_contained_atomic_write();
    init_project_config();
    init_project_config_reader();
    init_protected_project_path();
    init_project_config_transaction();
  }
});

// domains/workflow-contract/builtins.ts
var init_builtins = __esm({
  "domains/workflow-contract/builtins.ts"() {
    "use strict";
  }
});

// domains/workflow-contract/hash.ts
var init_hash = __esm({
  "domains/workflow-contract/hash.ts"() {
    "use strict";
  }
});

// domains/workflow-contract/validation.ts
var init_validation = __esm({
  "domains/workflow-contract/validation.ts"() {
    "use strict";
    init_builtins();
  }
});

// domains/workflow-contract/normalize.ts
var init_normalize = __esm({
  "domains/workflow-contract/normalize.ts"() {
    "use strict";
    init_builtins();
    init_validation();
  }
});

// domains/workflow-contract/index.ts
var init_workflow_contract = __esm({
  "domains/workflow-contract/index.ts"() {
    "use strict";
    init_builtins();
    init_contained_atomic_write();
    init_hash();
    init_normalize();
    init_project_config();
    init_protected_project_path();
    init_project_config_reader();
    init_project_config_writer();
    init_project_config_transaction();
    init_validation();
  }
});

// domains/engine/protected-run-file.ts
import { TextDecoder } from "util";
function identityOf2(stat) {
  return { dev: stat.dev, ino: stat.ino, birthtime: stat.birthtimeMs };
}
function decodeRunText(result5, label) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(result5.bytes);
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8`, { cause: error });
  }
}
async function readSnapshot(changeDir, relativePath2, maxBytes, label, options = {}) {
  try {
    const result5 = await readProtectedProjectFile(changeDir, relativePath2, maxBytes, {
      label,
      hooks: options.hooks
    });
    return { result: result5, text: decodeRunText(result5, label) };
  } catch (error) {
    const code = error.code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}
async function readOptionalEngineRunText(changeDir, relativePath2, maxBytes, label, options = {}) {
  return (await readSnapshot(changeDir, relativePath2, maxBytes, label, options))?.text ?? null;
}
async function writeEngineRunText(changeDir, relativePath2, content, maxBytes, label, options = {}) {
  if (Buffer.byteLength(content, "utf8") > maxBytes) {
    throw new Error(`${label} exceeds ${maxBytes} bytes`);
  }
  const expected = await readSnapshot(changeDir, relativePath2, maxBytes, label);
  const inspection = await inspectProtectedProjectPath(changeDir, relativePath2, {
    label,
    expected: "file"
  });
  await atomicWriteContainedText(inspection.target, content, {
    containedRoot: inspection.projectRoot,
    beforeCommit: async () => {
      await options.beforeCommit?.();
      const current = await readSnapshot(changeDir, relativePath2, maxBytes, label);
      if (!expected && !current) return;
      if (!expected || !current) {
        throw new Error(`${label} changed before commit`);
      }
      if (expected.result.realPath !== current.result.realPath || !sameFileObject(identityOf2(expected.result.stat), identityOf2(current.result.stat)) || expected.text !== current.text) {
        throw new Error(`${label} changed before commit`);
      }
    }
  });
}
async function appendEngineRunText(changeDir, relativePath2, addition, maxBytes, label, options = {}) {
  const existing = await readOptionalEngineRunText(changeDir, relativePath2, maxBytes, label);
  await writeEngineRunText(
    changeDir,
    relativePath2,
    `${existing ?? ""}${addition}`,
    maxBytes,
    label,
    options
  );
}
async function removeEngineRunFile(changeDir, relativePath2, label, options = {}) {
  const inspection = await inspectProtectedProjectPath(changeDir, relativePath2, {
    label,
    expected: "file"
  });
  if (!inspection.exists) return false;
  return removeContainedFile(inspection.target, {
    containedRoot: inspection.projectRoot,
    beforeRemove: options.beforeRemove
  });
}
var init_protected_run_file = __esm({
  "domains/engine/protected-run-file.ts"() {
    "use strict";
    init_workflow_contract();
    init_file_identity();
  }
});

// domains/engine/state.ts
var state_exports = {};
__export(state_exports, {
  RUN_STATE_FILE: () => RUN_STATE_FILE,
  applyRunStateToDocument: () => applyRunStateToDocument,
  readRunState: () => readRunState,
  removeRunState: () => removeRunState,
  runStateFromDocument: () => runStateFromDocument,
  writeRunState: () => writeRunState
});
import path11 from "path";
function requiredString(doc, key) {
  const value = doc[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid Run state: ${key} must be a non-empty string`);
  }
  return value;
}
function requiredRunReference(doc, key) {
  const value = requiredString(doc, key);
  if (path11.isAbsolute(value) || /^(?:[A-Za-z]:|[\\/]|~)/u.test(value) || value.split(/[\\/]/u).includes("..")) {
    throw new Error(`Invalid Run state: ${key} must stay inside the change directory`);
  }
  return value;
}
function retries(doc) {
  const raw = doc.run_retries ?? "{}";
  let value;
  try {
    value = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (error) {
    throw new Error("Invalid Run state: run_retries must be a JSON object", { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Run state: run_retries must be a JSON object");
  }
  for (const count of Object.values(value)) {
    if (!Number.isInteger(count) || Number(count) < 0) {
      throw new Error("Invalid Run state: retry counts must be non-negative integers");
    }
  }
  return value;
}
function runStateFromDocument(doc) {
  if (!doc.run_id) return null;
  const runId = requiredString(doc, "run_id");
  const skill = requiredString(doc, "skill");
  const skillVersion = requiredString(doc, "skill_version");
  const skillHash = requiredString(doc, "skill_hash");
  const pendingRef = requiredRunReference(doc, "pending_ref");
  const trajectoryRef = requiredRunReference(doc, "trajectory_ref");
  const contextRef = requiredRunReference(doc, "context_ref");
  const artifactsRef = requiredRunReference(doc, "artifacts_ref");
  const checkpointRef = requiredRunReference(doc, "checkpoint_ref");
  const iteration = Number(doc.iteration);
  if (!Number.isInteger(iteration) || iteration < 0) {
    throw new Error("Invalid Run state: iteration must be a non-negative integer");
  }
  if (doc.orchestration !== "deterministic" && doc.orchestration !== "adaptive") {
    throw new Error("Invalid Run state: orchestration must be deterministic or adaptive");
  }
  if (doc.run_status !== "running" && doc.run_status !== "waiting" && doc.run_status !== "completed" && doc.run_status !== "failed") {
    throw new Error("Invalid Run state: run_status is invalid");
  }
  return {
    runId,
    skill,
    skillVersion,
    skillHash,
    orchestration: doc.orchestration,
    currentStep: field(doc, "current_step"),
    iteration,
    pending: field(doc, "pending"),
    pendingRef,
    trajectoryRef,
    contextRef,
    artifactsRef,
    checkpointRef,
    status: doc.run_status,
    retries: retries(doc)
  };
}
function applyRunStateToDocument(doc, state) {
  if (state) {
    doc.run_id = state.runId;
  } else {
    delete doc.run_id;
  }
}
function runStateToJson(state) {
  return {
    runId: state.runId,
    skill: state.skill,
    skillVersion: state.skillVersion,
    skillHash: state.skillHash,
    orchestration: state.orchestration,
    currentStep: state.currentStep,
    iteration: state.iteration,
    pending: state.pending,
    pendingRef: state.pendingRef,
    trajectoryRef: state.trajectoryRef,
    contextRef: state.contextRef,
    artifactsRef: state.artifactsRef,
    checkpointRef: state.checkpointRef,
    status: state.status,
    retries: state.retries
  };
}
function runStateFromJson(json) {
  const doc = {
    run_id: json.runId,
    skill: json.skill,
    skill_version: json.skillVersion,
    skill_hash: json.skillHash,
    orchestration: json.orchestration,
    current_step: json.currentStep,
    iteration: json.iteration,
    pending: json.pending,
    pending_ref: json.pendingRef,
    trajectory_ref: json.trajectoryRef,
    context_ref: json.contextRef,
    artifacts_ref: json.artifactsRef,
    checkpoint_ref: json.checkpointRef,
    run_status: json.status,
    run_retries: JSON.stringify(json.retries)
  };
  return runStateFromDocument(doc);
}
async function readRunState(changeDir, options = {}) {
  const raw = await readOptionalEngineRunText(
    changeDir,
    RUN_STATE_FILE,
    RUN_STATE_MAX_BYTES,
    "Run state",
    options
  );
  if (raw === null) return null;
  const json = JSON.parse(raw);
  return runStateFromJson(json);
}
async function writeRunState(changeDir, state, options = {}) {
  await writeEngineRunText(
    changeDir,
    RUN_STATE_FILE,
    JSON.stringify(runStateToJson(state), null, 2),
    RUN_STATE_MAX_BYTES,
    "Run state",
    options
  );
}
async function removeRunState(changeDir, options = {}) {
  await removeEngineRunFile(changeDir, RUN_STATE_FILE, "Run state", options);
}
var field, RUN_STATE_FILE, RUN_STATE_MAX_BYTES;
var init_state = __esm({
  "domains/engine/state.ts"() {
    "use strict";
    init_protected_run_file();
    field = (doc, key) => {
      const value = doc[key];
      return value === null || value === void 0 ? null : String(value);
    };
    RUN_STATE_FILE = ".comet/run-state.json";
    RUN_STATE_MAX_BYTES = 256 * 1024;
  }
});

// domains/comet-classic/classic-cli.ts
import { pathToFileURL } from "url";

// domains/comet-classic/classic-archive.ts
import { createHash as createHash6 } from "crypto";
import { promises as fs16 } from "fs";
import path22 from "path";

// domains/comet-classic/classic-openspec-command.ts
import { spawnSync } from "child_process";

// platform/process/shell-quote.ts
function quoteForShell(arg) {
  if (arg.length > 0 && /^[A-Za-z0-9@+=:,./\\_-]+$/.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/"/g, '""')}"`;
}
function quoteArgsForShell(args) {
  return args.map((arg) => quoteForShell(arg));
}

// domains/comet-classic/classic-layout.ts
import { promises as fs7 } from "fs";
import path5 from "path";

// platform/fs/file-system.ts
import { promises as fs } from "fs";
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}
async function readDir(dirPath) {
  try {
    return await fs.readdir(dirPath);
  } catch (error) {
    const code = error?.code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return [];
    }
    throw error;
  }
}
function isMissingPathError(error) {
  const code = error?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

// domains/comet-classic/classic-layout.ts
init_project_config();
init_project_config_reader();
init_project_config_writer();
init_protected_project_path();
var ClassicLayoutUnavailableError = class extends Error {
  code = "classic-layout-unavailable";
  constructor(message = "Classic artifact layout is unavailable from .comet/config.yaml") {
    super(message);
    this.name = "ClassicLayoutUnavailableError";
  }
};
var ClassicLayoutConflictError = class extends Error {
  constructor(configuredRoot, alternateRoot, projectRoot) {
    const configured = classicProjectRelative(projectRoot, configuredRoot);
    const alternate = classicProjectRelative(projectRoot, alternateRoot);
    super(
      `Classic layout conflict: both ${configured}/ and ${alternate}/ exist; run comet doctor and resolve the conflict before writing`
    );
    this.configuredRoot = configuredRoot;
    this.alternateRoot = alternateRoot;
    this.name = "ClassicLayoutConflictError";
  }
  configuredRoot;
  alternateRoot;
  code = "classic-layout-conflict";
};
var PROJECT_CONFIG_RELATIVE_PATH = ".comet/config.yaml";
function isMissingPath2(error) {
  const code = error?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}
async function assertClassicConfigPhysical(projectRoot) {
  await inspectProtectedProjectPath(projectRoot, PROJECT_CONFIG_RELATIVE_PATH, {
    label: PROJECT_CONFIG_RELATIVE_PATH,
    expected: "file"
  });
}
function classicLayoutPaths(projectRoot, artifactLayout) {
  const root = path5.resolve(projectRoot);
  const openSpecBase = artifactLayout === "docs" ? path5.join(root, "docs") : root;
  const openSpecRoot = path5.join(openSpecBase, "openspec");
  const superpowersRoot = path5.join(root, "docs", "superpowers");
  return {
    projectRoot: root,
    artifactLayout,
    openSpecBase,
    openSpecRoot,
    changesDir: path5.join(openSpecRoot, "changes"),
    archiveDir: path5.join(openSpecRoot, "changes", "archive"),
    specsDir: path5.join(openSpecRoot, "specs"),
    superpowersRoot,
    superpowersSpecsDir: path5.join(superpowersRoot, "specs"),
    superpowersPlansDir: path5.join(superpowersRoot, "plans"),
    superpowersReportsDir: path5.join(superpowersRoot, "reports")
  };
}
async function readClassicArtifactLayout(projectRoot) {
  await assertClassicConfigPhysical(projectRoot);
  const document = await readWorkflowProjectConfigDocument(projectRoot, {
    allowPartialProject: true
  });
  if (!document?.config) {
    throw new ClassicLayoutUnavailableError();
  }
  const workflows = document.config.workflows ?? [document.config.default_workflow];
  if (!workflows.includes("classic")) {
    throw new ClassicLayoutUnavailableError(
      "Classic artifact layout is unavailable because Classic is not enabled"
    );
  }
  return document.classic?.artifact_layout ?? "legacy";
}
async function assertClassicWorkflowEnabled(projectRoot) {
  await assertClassicConfigPhysical(projectRoot);
  const config = (await readWorkflowProjectConfigDocument(projectRoot))?.config;
  if (!config) {
    throw new Error(".comet/config.yaml must use comet.project.v1 before migration");
  }
  const workflows = config.workflows ?? [config.default_workflow];
  if (!workflows.includes("classic")) {
    throw new Error("Classic root move requires the Classic workflow to be enabled");
  }
}
async function writeClassicArtifactLayout(projectRoot, artifactLayout, options = {}) {
  await assertClassicConfigPhysical(projectRoot);
  const snapshot = await readWorkflowProjectConfigSnapshot(projectRoot, {
    allowPartialProject: true
  });
  const parsed = snapshot.document;
  if (!parsed) throw new Error(".comet/config.yaml does not exist");
  const classic = parsed.value.classic;
  if (!classic || typeof classic !== "object" || Array.isArray(classic)) {
    throw new Error("classic must be a mapping");
  }
  const document = {
    ...parsed.value,
    classic: {
      ...classic,
      artifact_layout: artifactLayout
    }
  };
  const output = renderStructuredProjectConfig(
    document,
    parsed.classic?.language === "zh-CN" || parsed.native?.language === "zh-CN" ? "zh-CN" : "en"
  );
  parseWorkflowProjectConfigDocument(output, { allowPartialProject: true });
  await writeWorkflowProjectConfigSource(projectRoot, output, {
    expectedIdentity: options.expectedIdentity ?? snapshot.identity,
    beforeCommit: options.beforeCommit
  });
}
async function resolveClassicLayout(projectRoot) {
  return classicLayoutPaths(projectRoot, await readClassicArtifactLayout(projectRoot));
}
async function inspectClassicLayout(projectRoot) {
  const paths = await resolveClassicLayout(projectRoot);
  const alternateLayout = paths.artifactLayout === "legacy" ? "docs" : "legacy";
  const alternateRoot = classicLayoutPaths(projectRoot, alternateLayout).openSpecRoot;
  const [configuredRoot, alternate] = await Promise.all([
    inspectProtectedProjectPath(
      paths.projectRoot,
      classicProjectRelative(paths.projectRoot, paths.openSpecRoot),
      {
        label: "Configured Classic OpenSpec root",
        expected: "directory"
      }
    ),
    inspectProtectedProjectPath(
      paths.projectRoot,
      classicProjectRelative(paths.projectRoot, alternateRoot),
      {
        label: "Alternate Classic OpenSpec root",
        expected: "directory"
      }
    )
  ]);
  const configuredRootExists = configuredRoot.exists;
  const alternateRootExists = alternate.exists;
  return {
    paths,
    configuredRootExists,
    alternateRoot,
    alternateRootExists,
    dualRoots: configuredRootExists && alternateRootExists
  };
}
async function assertClassicManagedRootsPhysical(paths, alternateRoot) {
  const managedRoots = [
    paths.openSpecRoot,
    paths.changesDir,
    paths.archiveDir,
    paths.specsDir,
    alternateRoot,
    paths.superpowersRoot,
    paths.superpowersSpecsDir,
    paths.superpowersPlansDir,
    paths.superpowersReportsDir
  ];
  for (const target of managedRoots) {
    const relative = classicProjectRelative(paths.projectRoot, target);
    await inspectProtectedProjectPath(paths.projectRoot, relative, {
      label: `Classic managed physical path ${relative}`,
      expected: "directory"
    });
  }
}
async function assertClassicLayoutReadable(projectRoot) {
  const inspection = await inspectClassicLayout(projectRoot);
  await assertClassicManagedRootsPhysical(inspection.paths, inspection.alternateRoot);
  if (inspection.dualRoots) {
    throw new ClassicLayoutConflictError(
      inspection.paths.openSpecRoot,
      inspection.alternateRoot,
      inspection.paths.projectRoot
    );
  }
  if (!inspection.configuredRootExists) {
    const configured = classicProjectRelative(
      inspection.paths.projectRoot,
      inspection.paths.openSpecRoot
    );
    const alternate = classicProjectRelative(
      inspection.paths.projectRoot,
      inspection.alternateRoot
    );
    throw new ClassicLayoutUnavailableError(
      `Configured Classic OpenSpec root is missing: ${configured} (alternate ${alternate} is ${inspection.alternateRootExists ? "present" : "missing"})`
    );
  }
  return inspection.paths;
}
async function assertClassicLayoutWritable(projectRoot) {
  const pendingMove = path5.join(path5.resolve(projectRoot), ".comet", "classic-root-move.json");
  if (await fileExists(pendingMove)) {
    throw new Error(
      "Classic root move transaction is incomplete; inspect it with comet doctor and recover it explicitly before writing"
    );
  }
  const paths = await assertClassicLayoutReadable(projectRoot);
  if (!await fileExists(paths.openSpecRoot)) {
    throw new Error(
      `Configured Classic OpenSpec root is missing: ${classicProjectRelative(
        paths.projectRoot,
        paths.openSpecRoot
      )}`
    );
  }
  return paths;
}
async function discoverClassicProject(startPath) {
  let cursor = path5.resolve(startPath);
  let openSpecFallback = null;
  try {
    if (!(await fs7.lstat(cursor)).isDirectory()) cursor = path5.dirname(cursor);
  } catch (error) {
    if (!isMissingPath2(error)) throw error;
  }
  for (; ; ) {
    if (path5.basename(cursor) === "openspec") {
      openSpecFallback = path5.dirname(cursor);
    }
    const configFile = path5.join(cursor, ".comet", "config.yaml");
    let projectConfig = false;
    if (await fileExists(configFile)) {
      try {
        await assertClassicConfigPhysical(cursor);
        const value = (await readWorkflowProjectConfigDocument(cursor))?.value;
        projectConfig = Boolean(value) && typeof value === "object" && !Array.isArray(value) && (value.schema === "comet.project.v1" || value.default_workflow !== void 0 || value.native !== void 0);
      } catch {
      }
    }
    if (projectConfig || await fileExists(path5.join(cursor, ".git"))) {
      return cursor;
    }
    const parent = path5.dirname(cursor);
    if (parent === cursor) return openSpecFallback ?? path5.resolve(startPath);
    cursor = parent;
  }
}
function classicProjectRelative(projectRoot, target) {
  return path5.relative(path5.resolve(projectRoot), target).replaceAll("\\", "/");
}

// domains/comet-classic/classic-openspec-root.ts
var import_yaml2 = __toESM(require_dist(), 1);
init_protected_project_path();
import path6 from "path";
var OPENSPEC_CONFIG_MAX_BYTES = 1024 * 1024;
async function assertClassicOpenSpecRootHealthy(projectRoot, layout) {
  const resolvedLayout = layout ?? await assertClassicLayoutReadable(projectRoot);
  const configPath = path6.join(resolvedLayout.openSpecRoot, "config.yaml");
  const relativeConfig = classicProjectRelative(resolvedLayout.projectRoot, configPath);
  let source;
  try {
    const result5 = await readProtectedProjectFile(
      resolvedLayout.projectRoot,
      relativeConfig,
      OPENSPEC_CONFIG_MAX_BYTES,
      {
        label: "Classic OpenSpec project config",
        bigint: true
      }
    );
    source = result5.bytes.toString("utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        `Classic OpenSpec root is unhealthy: ${relativeConfig} is missing; rerun OpenSpec initialization for the configured Classic layout`,
        { cause: error }
      );
    }
    throw new Error(
      `Classic OpenSpec root is unhealthy: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  const document = (0, import_yaml2.parseDocument)(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(
      `Classic OpenSpec root is unhealthy: ${relativeConfig} is invalid YAML (${document.errors[0].message})`
    );
  }
  const value = document.toJS();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Classic OpenSpec root is unhealthy: ${relativeConfig} must contain a mapping`);
  }
  const schema = value.schema;
  if (typeof schema !== "string" || schema.trim() === "") {
    throw new Error(
      `Classic OpenSpec root is unhealthy: ${relativeConfig} must declare a non-empty schema`
    );
  }
  return {
    layout: resolvedLayout,
    configPath: relativeConfig,
    schema
  };
}

// domains/comet-classic/classic-openspec-command.ts
function normalizedArguments(args) {
  return args[0] === "--" ? args.slice(1) : [...args];
}
async function executeClassicOpenSpec(args, startPath = process.cwd()) {
  const openSpecArgs = normalizedArguments(args);
  if (openSpecArgs.length === 0) {
    return {
      exitCode: 64,
      stderr: "Usage: comet classic openspec -- <openspec-args...>"
    };
  }
  const projectRoot = await discoverClassicProject(startPath);
  const layout = await assertClassicLayoutWritable(projectRoot);
  await assertClassicOpenSpecRootHealthy(projectRoot, layout);
  const command = process.env.COMET_OPENSPEC || "openspec";
  const useShell = process.platform === "win32";
  const result5 = spawnSync(command, useShell ? quoteArgsForShell(openSpecArgs) : openSpecArgs, {
    cwd: layout.openSpecBase,
    encoding: "utf8",
    shell: useShell,
    windowsHide: true
  });
  if (result5.error) {
    const code = result5.error.code;
    return {
      exitCode: code === "ENOENT" ? 127 : 70,
      stdout: result5.stdout || void 0,
      stderr: result5.stderr || (code === "ENOENT" ? `OpenSpec CLI not found: ${command}` : result5.error.message)
    };
  }
  return {
    exitCode: result5.status ?? 1,
    stdout: result5.stdout || void 0,
    stderr: result5.stderr || void 0
  };
}
var classicOpenSpecCommand = async (args) => {
  return executeClassicOpenSpec(args);
};

// domains/comet-classic/classic-paths.ts
import { promises as fs8 } from "fs";
import path8 from "path";

// domains/comet-classic/classic-protected-path.ts
init_contained_atomic_write();
init_project_config();
init_protected_project_path();
import path7 from "path";
var CLASSIC_PROJECT_FILE_MAX_BYTES = 2 * 1024 * 1024;
function projectTarget(projectRoot, target, label) {
  const root = path7.resolve(projectRoot);
  const absolute = path7.isAbsolute(target) ? path7.resolve(target) : path7.resolve(root, target);
  const relative = path7.relative(root, absolute).replaceAll("\\", "/");
  return {
    root,
    relative: normalizeWorkflowRelativePath(relative, label),
    target: absolute
  };
}
async function inspectClassicProjectTarget(projectRoot, target, options) {
  const resolved = projectTarget(projectRoot, target, options.label);
  return inspectProtectedProjectPath(resolved.root, resolved.relative, options);
}
async function classicProjectTargetExists(projectRoot, target, options) {
  return (await inspectClassicProjectTarget(projectRoot, target, {
    label: options.label,
    expected: options.expected ?? "any"
  })).exists;
}
async function classicProjectFileNonempty(projectRoot, target, label, hooks) {
  if (!await classicProjectTargetExists(projectRoot, target, {
    label,
    expected: "file"
  })) {
    return false;
  }
  return (await readClassicProjectBytes(projectRoot, target, {
    label,
    hooks
  })).byteLength > 0;
}
async function readClassicProjectFile(projectRoot, target, options) {
  return (await readClassicProjectBytes(projectRoot, target, options)).toString("utf8");
}
async function readClassicProjectBytes(projectRoot, target, options) {
  const resolved = projectTarget(projectRoot, target, options.label);
  return (await readProtectedProjectFile(
    resolved.root,
    resolved.relative,
    options.maxBytes ?? CLASSIC_PROJECT_FILE_MAX_BYTES,
    { label: options.label, hooks: options.hooks }
  )).bytes;
}
async function ensureClassicProjectDirectory(projectRoot, target, label) {
  const resolved = projectTarget(projectRoot, target, label);
  return ensureProtectedProjectDirectory(resolved.root, resolved.relative, { label });
}
async function writeClassicProjectText(projectRoot, target, content, options) {
  const resolved = projectTarget(projectRoot, target, options.label);
  await inspectProtectedProjectPath(resolved.root, resolved.relative, {
    label: options.label,
    expected: "file"
  });
  await atomicWriteContainedText(resolved.target, content, {
    containedRoot: resolved.root,
    beforeTemporaryOpen: options.beforeTemporaryOpen,
    beforeCommit: options.beforeCommit,
    exclusive: options.exclusive
  });
}

// domains/comet-classic/classic-paths.ts
function openSpecChangeNameError(name) {
  if (!name) return "Change name cannot be empty";
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(name)) {
    return `Invalid change name: '${name}'
Valid format: lowercase kebab-case (a-z, 0-9, single hyphens)`;
  }
  if (name.includes("..")) return "Change name cannot contain '..' (path traversal not allowed)";
  return null;
}
function assertOpenSpecChangeName(name) {
  const error = openSpecChangeNameError(name);
  if (error) throw new Error(error);
}
function changeDirectory(projectRoot, directory) {
  return {
    label: classicProjectRelative(projectRoot, directory),
    directory
  };
}
async function inspectChangeDirectory(projectRoot, directory, label) {
  const change = changeDirectory(projectRoot, directory);
  const inspection = await inspectClassicProjectTarget(projectRoot, directory, {
    label,
    expected: "directory"
  });
  if (!inspection.exists) return { change, exists: false, stateExists: false };
  const state = await inspectClassicProjectTarget(
    projectRoot,
    path8.join(directory, ".comet.yaml"),
    {
      label: `${label} state`,
      expected: "file"
    }
  );
  return { change, exists: true, stateExists: state.exists };
}
function archiveNameMatchesChange(entryName, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${escaped}$`, "u").test(entryName);
}
async function findArchiveChangeDirectory(projectRoot, archiveDir, name, options = {}) {
  if (!options.skipExactCompatibility) {
    const exact = await inspectChangeDirectory(
      projectRoot,
      path8.join(archiveDir, name),
      `Classic archived change ${name}`
    );
    if (exact.exists) return exact.change;
  }
  const archive = await inspectClassicProjectTarget(projectRoot, archiveDir, {
    label: "Classic archive directory",
    expected: "directory"
  });
  if (!archive.exists) return null;
  const matches = [];
  for (const entry2 of await fs8.readdir(archiveDir, { withFileTypes: true })) {
    if (!archiveNameMatchesChange(entry2.name, name)) continue;
    const candidate = await inspectChangeDirectory(
      projectRoot,
      path8.join(archiveDir, entry2.name),
      `Classic archived change ${entry2.name}`
    );
    if (candidate.exists && candidate.stateExists) matches.push(candidate.change);
  }
  return matches.sort((left, right) => right.directory.localeCompare(left.directory))[0] ?? null;
}
async function inspectClassicActiveChangeDirectory(name, projectRoot = process.cwd()) {
  assertOpenSpecChangeName(name);
  const layout = await assertClassicLayoutReadable(projectRoot);
  const inspection = await inspectChangeDirectory(
    layout.projectRoot,
    path8.join(layout.changesDir, name),
    `Classic active change ${name}`
  );
  return {
    ...inspection.change,
    exists: inspection.exists,
    stateExists: inspection.stateExists
  };
}
async function ensureClassicActiveChangeDirectory(name, projectRoot = process.cwd()) {
  assertOpenSpecChangeName(name);
  const layout = await assertClassicLayoutWritable(projectRoot);
  const directory = path8.join(layout.changesDir, name);
  const inspection = await inspectChangeDirectory(
    layout.projectRoot,
    directory,
    `Classic active change ${name}`
  );
  if (!inspection.exists) {
    await ensureClassicProjectDirectory(
      layout.projectRoot,
      directory,
      `Classic active change ${name}`
    );
  }
  return inspection.change;
}
async function findClassicArchiveChangeDirectory(name, projectRoot = process.cwd(), options = {}) {
  assertOpenSpecChangeName(name);
  const layout = await assertClassicLayoutReadable(projectRoot);
  if (options.preferredArchiveName !== void 0) {
    const preferred = options.preferredArchiveName;
    if (preferred !== name && !archiveNameMatchesChange(preferred, name)) {
      throw new Error(
        `Classic preferred archive name '${preferred}' does not belong to change '${name}'`
      );
    }
    const inspection = await inspectChangeDirectory(
      layout.projectRoot,
      path8.join(layout.archiveDir, preferred),
      `Classic preferred archived change ${preferred}`
    );
    return inspection.exists && inspection.stateExists ? inspection.change : null;
  }
  return findArchiveChangeDirectory(layout.projectRoot, layout.archiveDir, name, options);
}
async function resolveClassicChangeDirectory(name, projectRoot = process.cwd()) {
  assertOpenSpecChangeName(name);
  const layout = await assertClassicLayoutReadable(projectRoot);
  const active = await inspectChangeDirectory(
    layout.projectRoot,
    path8.join(layout.changesDir, name),
    `Classic active change ${name}`
  );
  if (active.exists) return active.change;
  const archived = await findArchiveChangeDirectory(layout.projectRoot, layout.archiveDir, name);
  if (archived) return archived;
  return active.change;
}

// domains/comet-classic/classic-runtime-run.ts
import { promises as fs13 } from "fs";
import path18 from "path";
import { fileURLToPath } from "url";

// domains/comet-classic/classic-evidence.ts
import { promises as fs9 } from "fs";
import path10 from "path";

// domains/comet-classic/classic-archive-pointer.ts
init_protected_project_path();
init_project_config();
import path9 from "path";
function isMissingPath3(error) {
  const code = error?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}
async function readLegacyArchivedHandoffFallback(projectRoot, changeDir, pointer, maxBytes) {
  const source = normalizeWorkflowRelativePath(pointer, "Classic handoff artifact pointer");
  const original = await inspectProtectedProjectPath(projectRoot, source, {
    label: "Classic handoff artifact",
    expected: "file"
  });
  if (original.exists) return null;
  const layout = await assertClassicLayoutReadable(projectRoot);
  const configuredChangesPrefix = `${classicProjectRelative(projectRoot, layout.changesDir)}/`;
  const acceptedPrefixes = layout.artifactLayout === "docs" ? [configuredChangesPrefix, "openspec/changes/"] : [configuredChangesPrefix];
  const pointerPrefix = acceptedPrefixes.find((prefix) => source.startsWith(prefix));
  if (!pointerPrefix) return null;
  const pointerSegments = source.slice(pointerPrefix.length).split("/");
  if (pointerSegments.length < 4 || pointerSegments[1] !== ".comet" || pointerSegments.slice(2).some((segment) => segment.length === 0)) {
    return null;
  }
  const pointerChange = pointerSegments[0];
  assertOpenSpecChangeName(pointerChange);
  const suffix = pointerSegments.slice(2);
  const archivedChange = path9.resolve(changeDir);
  if (path9.dirname(archivedChange) !== path9.resolve(layout.archiveDir)) return null;
  const archivedName = path9.basename(archivedChange);
  const datedArchive = /^\d{4}-\d{2}-\d{2}-(.+)$/u.exec(archivedName);
  if (archivedName !== pointerChange && datedArchive?.[1] !== pointerChange) return null;
  await inspectProtectedProjectPath(
    projectRoot,
    classicProjectRelative(projectRoot, archivedChange),
    {
      label: "Classic archived change directory",
      expected: "directory"
    }
  );
  const mapped = path9.join(archivedChange, ".comet", ...suffix);
  const mappedRelative = classicProjectRelative(projectRoot, mapped);
  try {
    await readProtectedProjectFile(projectRoot, mappedRelative, maxBytes, {
      label: "Historical Classic archived handoff artifact"
    });
    return mappedRelative;
  } catch (error) {
    if (isMissingPath3(error)) return null;
    throw error;
  }
}

// domains/comet-classic/classic-evidence.ts
init_protected_project_path();
var CLASSIC_ARTIFACT_MAX_BYTES = 2 * 1024 * 1024;
function relativeSource(projectRoot, file) {
  return path10.relative(projectRoot, file).split(path10.sep).join("/");
}
async function linkedFileEvidence(projectRoot, code, relativePath2) {
  if (!relativePath2) return { code, satisfied: false };
  const source = relativePath2.replaceAll("\\", "/");
  try {
    const satisfied = await protectedProjectFileExists(projectRoot, source, {
      label: `${code} artifact`
    });
    return {
      code,
      satisfied,
      source,
      ...satisfied ? { resolvedSource: source } : {}
    };
  } catch (error) {
    return {
      code,
      satisfied: false,
      source,
      detail: `unsafe artifact pointer outside the project or through a special path: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
async function archivedHandoffEvidence(projectRoot, changeDir, relativePath2) {
  try {
    await assertClassicLayoutReadable(projectRoot);
  } catch (error) {
    return {
      code: "design.handoff",
      satisfied: false,
      ...relativePath2 ? { source: relativePath2.replaceAll("\\", "/") } : {},
      detail: `Classic layout is unsafe or unavailable for handoff evidence: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  const evidence = await linkedFileEvidence(projectRoot, "design.handoff", relativePath2);
  if (!relativePath2 || evidence.satisfied || evidence.detail) return evidence;
  try {
    const mapped = await readLegacyArchivedHandoffFallback(
      projectRoot,
      changeDir,
      relativePath2,
      CLASSIC_ARTIFACT_MAX_BYTES
    );
    if (!mapped) return evidence;
    return {
      ...evidence,
      satisfied: true,
      resolvedSource: mapped,
      detail: `resolved historical legacy pointer from archived change: ${mapped}`
    };
  } catch (error) {
    return {
      ...evidence,
      satisfied: false,
      detail: `unsafe archived handoff fallback: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
async function directFileEvidence(projectRoot, code, file) {
  return linkedFileEvidence(projectRoot, code, relativeSource(projectRoot, file));
}
async function deltaSpecEvidence(projectRoot, changeDir) {
  const specsDir = path10.join(changeDir, "specs");
  let entries;
  try {
    const relativeSpecs = relativeSource(projectRoot, specsDir);
    const inspection = await inspectProtectedProjectPath(projectRoot, relativeSpecs, {
      label: "OpenSpec delta-spec directory",
      expected: "directory"
    });
    if (!inspection.exists) {
      return { code: "openspec.delta-spec", satisfied: false };
    }
    entries = await fs9.readdir(specsDir);
  } catch (error) {
    if (error.code === "ENOENT") {
      return { code: "openspec.delta-spec", satisfied: false };
    }
    return {
      code: "openspec.delta-spec",
      satisfied: false,
      detail: `unsafe delta-spec path: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  const candidates = entries.map((entry2) => path10.join(specsDir, entry2, "spec.md"));
  const existing = (await Promise.all(
    candidates.map(async (file) => {
      try {
        return await protectedProjectFileExists(projectRoot, relativeSource(projectRoot, file), {
          label: "OpenSpec delta spec"
        }) ? file : null;
      } catch {
        return null;
      }
    })
  )).filter((file) => file !== null);
  return {
    code: "openspec.delta-spec",
    satisfied: existing.length > 0,
    source: existing[0] ? relativeSource(projectRoot, existing[0]) : void 0,
    detail: `${existing.length} delta spec${existing.length === 1 ? "" : "s"}`
  };
}
async function taskEvidence(projectRoot, tasksFile) {
  let source;
  const relative = relativeSource(projectRoot, tasksFile);
  try {
    source = (await readProtectedProjectFile(projectRoot, relative, CLASSIC_ARTIFACT_MAX_BYTES, {
      label: "Classic tasks artifact"
    })).bytes.toString("utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return { code: "build.tasks-complete", satisfied: false };
    }
    return {
      code: "build.tasks-complete",
      satisfied: false,
      source: relative,
      detail: `unsafe tasks artifact: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  const tasks = [...source.matchAll(/^\s*[-*]\s+\[([ xX])\]\s+/gmu)];
  const complete = tasks.filter((match) => match[1].toLowerCase() === "x").length;
  return {
    code: "build.tasks-complete",
    satisfied: tasks.length > 0 && complete === tasks.length,
    source: relative,
    detail: `${complete} of ${tasks.length} tasks complete`
  };
}
function evidenceSatisfied(evidence, code) {
  return evidence.some((item) => item.code === code && item.satisfied);
}
async function collectClassicEvidence(changeDir, projection) {
  const projectRoot = await discoverClassicProject(changeDir);
  const classic = projection.classic;
  const proposal = path10.join(changeDir, "proposal.md");
  const design = path10.join(changeDir, "design.md");
  const tasks = path10.join(changeDir, "tasks.md");
  const checkpoint = projection.run ? path10.resolve(changeDir, projection.run.checkpointRef) : path10.join(changeDir, ".comet", "checkpoint.json");
  const evidence = await Promise.all([
    directFileEvidence(projectRoot, "openspec.proposal", proposal),
    directFileEvidence(projectRoot, "openspec.design", design),
    directFileEvidence(projectRoot, "openspec.tasks", tasks),
    deltaSpecEvidence(projectRoot, changeDir),
    linkedFileEvidence(projectRoot, "design.document", classic?.designDoc ?? null),
    linkedFileEvidence(projectRoot, "build.plan", classic?.plan ?? null),
    taskEvidence(projectRoot, tasks),
    linkedFileEvidence(projectRoot, "verification.report", classic?.verificationReport ?? null),
    archivedHandoffEvidence(projectRoot, changeDir, classic?.handoffContext ?? null),
    directFileEvidence(projectRoot, "run.checkpoint", checkpoint)
  ]);
  const handoff = evidence.find((item) => item.code === "design.handoff");
  if (handoff && !classic?.handoffHash) {
    handoff.satisfied = false;
    handoff.detail = "handoff hash is missing";
  }
  evidence.push({
    code: "archive.confirmed",
    satisfied: classic?.archiveConfirmation === "confirmed"
  });
  return evidence;
}

// domains/comet-classic/classic-migrate.ts
import { createHash as createHash5, randomUUID as randomUUID5 } from "crypto";
import { promises as fs12 } from "fs";
import path17 from "path";

// domains/comet-classic/classic-resolver.ts
function profileFor(classic) {
  return classic.classicProfile ?? classic.workflow;
}
function fullBuildConfigured(classic) {
  if (!classic.buildMode || !classic.tddMode || !classic.isolation || !classic.verifyMode) {
    return false;
  }
  if (classic.buildMode === "subagent-driven-development") {
    return classic.subagentDispatch === "confirmed";
  }
  if (classic.buildMode === "direct") return classic.directOverride === true;
  return true;
}
function presetBuildConfigured(classic) {
  return Boolean(
    classic.buildMode === "direct" && classic.tddMode === "direct" && classic.isolation !== null && classic.verifyMode === "light"
  );
}
function resolveBuild(profile, classic, evidence) {
  if (classic.verifyResult === "fail") {
    return profile === "full" ? "full.build.fix" : `${profile}.build.execute`;
  }
  if (profile === "full") {
    if (!evidenceSatisfied(evidence, "build.plan")) return "full.build.plan";
    if (classic.buildPause === "plan-ready") return "full.build.plan-ready";
    if (!fullBuildConfigured(classic)) return "full.build.configure";
  } else if (!presetBuildConfigured(classic)) {
    throw new Error(`${profile} build configuration is incomplete`);
  }
  return evidenceSatisfied(evidence, "build.tasks-complete") ? `${profile}.build.complete` : `${profile}.build.execute`;
}
function resolveVerify(profile, classic, evidence) {
  if (classic.verifyResult !== "pass" || !evidenceSatisfied(evidence, "verification.report")) {
    return `${profile}.verify.run`;
  }
  return `${profile}.verify.branch`;
}
function resolveArchive(profile, classic) {
  if (classic.verifyResult !== "pass") {
    throw new Error("archive requires verify_result=pass");
  }
  return classic.archiveConfirmation === "confirmed" ? `${profile}.archive.execute` : `${profile}.archive.confirm`;
}
function resolveClassicStepId(classic, evidence) {
  const profile = profileFor(classic);
  if (classic.archived && classic.phase !== "archive") {
    throw new Error("archived=true requires phase=archive");
  }
  if (classic.archived) return "completed";
  if (profile !== "full" && classic.phase === "design") {
    throw new Error(`${profile} workflow cannot enter design`);
  }
  switch (classic.phase) {
    case "open":
      return `${profile}.open`;
    case "design":
      return evidenceSatisfied(evidence, "design.handoff") ? "full.design.document" : "full.design.handoff";
    case "build":
      return resolveBuild(profile, classic, evidence);
    case "verify":
      return resolveVerify(profile, classic, evidence);
    case "archive":
      return resolveArchive(profile, classic);
  }
}

// domains/comet-classic/classic-store.ts
var import_yaml3 = __toESM(require_dist(), 1);
init_contained_atomic_write();
init_protected_project_path();
import path12 from "path";

// domains/comet-classic/classic-state.ts
init_state();
var CLASSIC_PROFILES = ["full", "hotfix", "tweak"];
var CLASSIC_MIGRATION_VERSION = 1;
var PHASES = ["open", "design", "build", "verify", "archive"];
var ARTIFACT_LANGUAGES = ["en", "zh-CN"];
var CONTEXT_COMPRESSION = ["off", "beta"];
var BUILD_MODES = ["subagent-driven-development", "executing-plans", "direct"];
var BUILD_PAUSES = ["plan-ready"];
var SUBAGENT_DISPATCH = ["confirmed"];
var TDD_MODES = ["tdd", "direct"];
var REVIEW_MODES = ["off", "standard", "thorough"];
var ISOLATIONS = ["current", "branch", "worktree"];
var VERIFY_MODES = ["light", "full"];
var VERIFY_RESULTS = ["pending", "pass", "fail"];
var BRANCH_STATUSES = ["pending", "handled"];
var ARCHIVE_CONFIRMATIONS = ["pending", "confirmed"];
var CLASSIC_WIRE_KEYS = [
  "workflow",
  "language",
  "phase",
  "context_compression",
  "build_mode",
  "build_pause",
  "subagent_dispatch",
  "tdd_mode",
  "review_mode",
  "isolation",
  "bound_branch",
  "verify_mode",
  "auto_transition",
  "base_ref",
  "design_doc",
  "plan",
  "verify_result",
  "verify_failures",
  "verification_report",
  "branch_status",
  "created_at",
  "verified_at",
  "archive_confirmation",
  "archived",
  "direct_override",
  "handoff_context",
  "handoff_hash",
  "classic_profile",
  "classic_migration"
];
var RUN_WIRE_KEYS = ["run_id"];
var KNOWN_KEYS = /* @__PURE__ */ new Set([...CLASSIC_WIRE_KEYS, ...RUN_WIRE_KEYS]);
var REQUIRED_CLASSIC_KEYS = [
  "workflow",
  "phase",
  "design_doc",
  "plan",
  "build_mode",
  "isolation",
  "verify_mode",
  "verify_result",
  "verified_at",
  "archived"
];
function has(doc, key) {
  return Object.prototype.hasOwnProperty.call(doc, key);
}
function nullableString(doc, key) {
  const value = doc[key];
  if (value === null || value === void 0 || value === "") return null;
  if (typeof value !== "string") {
    throw new Error(`Invalid Classic state: ${key} must be a string or null`);
  }
  return value;
}
function enumValue(doc, key, values, nullable = true) {
  const value = doc[key];
  if (value === null || value === void 0 || value === "") {
    if (nullable) return null;
    throw new Error(`Invalid Classic state: ${key} is required`);
  }
  if (typeof value !== "string" || !values.includes(value)) {
    throw new Error(
      `Invalid Classic state: ${key} must be one of ${values.join(", ")}${nullable ? " or null" : ""}`
    );
  }
  return value;
}
function booleanValue(doc, key, nullable = true) {
  const value = doc[key];
  if (value === null || value === void 0 || value === "") {
    if (nullable) return null;
    throw new Error(`Invalid Classic state: ${key} is required`);
  }
  if (typeof value !== "boolean") {
    throw new Error(`Invalid Classic state: ${key} must be true or false`);
  }
  return value;
}
function nonNegativeInteger(doc, key, fallback = 0) {
  const value = doc[key];
  if (value === null || value === void 0 || value === "") return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid Classic state: ${key} must be a non-negative integer`);
  }
  return value;
}
function relativePath(doc, key) {
  const value = nullableString(doc, key);
  if (value === null) return null;
  if (/^(?:[A-Za-z]:|[\\/]|~)/u.test(value) || value.split(/[\\/]/u).includes("..")) {
    throw new Error(`Invalid Classic state: ${key} must be a relative repository path`);
  }
  return value;
}
function sha2562(doc, key) {
  const value = nullableString(doc, key);
  if (value !== null && !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`Invalid Classic state: ${key} must be a sha256 hex digest`);
  }
  return value;
}
function migrationVersion(doc) {
  const value = doc.classic_migration;
  if (value === null || value === void 0 || value === "") return null;
  if (value !== CLASSIC_MIGRATION_VERSION) {
    throw new Error(
      `Invalid Classic state: classic_migration must be ${CLASSIC_MIGRATION_VERSION}`
    );
  }
  return value;
}
function classicStateFromDocument(doc) {
  const hasClassicProjection = CLASSIC_WIRE_KEYS.some((key) => has(doc, key));
  if (!hasClassicProjection) return null;
  for (const key of REQUIRED_CLASSIC_KEYS) {
    if (!has(doc, key)) return null;
  }
  return {
    workflow: enumValue(doc, "workflow", CLASSIC_PROFILES, false),
    language: enumValue(doc, "language", ARTIFACT_LANGUAGES),
    phase: enumValue(doc, "phase", PHASES, false),
    contextCompression: enumValue(doc, "context_compression", CONTEXT_COMPRESSION),
    buildMode: enumValue(doc, "build_mode", BUILD_MODES),
    buildPause: enumValue(doc, "build_pause", BUILD_PAUSES),
    subagentDispatch: enumValue(doc, "subagent_dispatch", SUBAGENT_DISPATCH),
    tddMode: enumValue(doc, "tdd_mode", TDD_MODES),
    reviewMode: enumValue(doc, "review_mode", REVIEW_MODES),
    isolation: enumValue(doc, "isolation", ISOLATIONS),
    boundBranch: nullableString(doc, "bound_branch"),
    verifyMode: enumValue(doc, "verify_mode", VERIFY_MODES),
    autoTransition: booleanValue(doc, "auto_transition"),
    baseRef: nullableString(doc, "base_ref"),
    designDoc: relativePath(doc, "design_doc"),
    plan: relativePath(doc, "plan"),
    verifyResult: enumValue(doc, "verify_result", VERIFY_RESULTS, false),
    verifyFailures: nonNegativeInteger(doc, "verify_failures"),
    verificationReport: relativePath(doc, "verification_report"),
    branchStatus: enumValue(doc, "branch_status", BRANCH_STATUSES),
    createdAt: nullableString(doc, "created_at"),
    verifiedAt: nullableString(doc, "verified_at"),
    archiveConfirmation: enumValue(doc, "archive_confirmation", ARCHIVE_CONFIRMATIONS),
    archived: booleanValue(doc, "archived", false),
    directOverride: booleanValue(doc, "direct_override"),
    handoffContext: relativePath(doc, "handoff_context"),
    handoffHash: sha2562(doc, "handoff_hash"),
    classicProfile: enumValue(doc, "classic_profile", CLASSIC_PROFILES),
    classicMigration: migrationVersion(doc)
  };
}
function parseClassicStateDocument(doc, run) {
  let resolvedRun = run ?? null;
  if (resolvedRun === null && run === void 0) {
    if (doc.run_id && doc.skill) {
      try {
        resolvedRun = runStateFromDocument(doc);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message.replace(/^Invalid Run state:/u, "Invalid Classic state:"), {
          cause: error
        });
      }
    }
  }
  return {
    classic: classicStateFromDocument(doc),
    run: resolvedRun,
    unknownKeys: Object.keys(doc).filter((key) => !KNOWN_KEYS.has(key))
  };
}
function readLegacyStateSummary(doc) {
  const workflowRaw = doc["workflow"];
  const phaseRaw = doc["phase"];
  const archivedRaw = doc["archived"];
  const designDocRaw = doc["design_doc"];
  return {
    workflow: typeof workflowRaw === "string" && CLASSIC_PROFILES.includes(workflowRaw) ? workflowRaw : null,
    phase: typeof phaseRaw === "string" && PHASES.includes(phaseRaw) ? phaseRaw : null,
    archived: archivedRaw === true,
    designDoc: typeof designDocRaw === "string" && designDocRaw !== "" ? designDocRaw : null,
    unknownKeys: Object.keys(doc).filter((key) => !KNOWN_KEYS.has(key))
  };
}
function classicStateToDocument(state) {
  return {
    workflow: state.workflow,
    language: state.language,
    phase: state.phase,
    context_compression: state.contextCompression,
    build_mode: state.buildMode,
    build_pause: state.buildPause,
    subagent_dispatch: state.subagentDispatch,
    tdd_mode: state.tddMode,
    review_mode: state.reviewMode,
    isolation: state.isolation,
    bound_branch: state.boundBranch,
    verify_mode: state.verifyMode,
    auto_transition: state.autoTransition,
    base_ref: state.baseRef,
    design_doc: state.designDoc,
    plan: state.plan,
    verify_result: state.verifyResult,
    verify_failures: state.verifyFailures,
    verification_report: state.verificationReport,
    branch_status: state.branchStatus,
    created_at: state.createdAt,
    verified_at: state.verifiedAt,
    archive_confirmation: state.archiveConfirmation,
    archived: state.archived,
    direct_override: state.directOverride,
    handoff_context: state.handoffContext,
    handoff_hash: state.handoffHash,
    classic_profile: state.classicProfile,
    classic_migration: state.classicMigration
  };
}

// domains/comet-classic/classic-store.ts
init_state();
var CLASSIC_STATE_MAX_BYTES = 2 * 1024 * 1024;
function documentRecord(document) {
  const value = document.toJS();
  if (value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Classic state document: root must be a mapping");
  }
  return value;
}
function setIfChanged(document, key, value) {
  if (document.get(key) !== value) document.set(key, value);
}
function applyProjection(document, projection) {
  if (projection.classic) {
    for (const [key, value] of Object.entries(classicStateToDocument(projection.classic))) {
      setIfChanged(document, key, value);
    }
  } else {
    for (const key of CLASSIC_WIRE_KEYS) document.delete(key);
  }
  applyRunStateToDocument(document.toJS(), projection.run);
  if (projection.run) {
    setIfChanged(document, "run_id", projection.run.runId);
  } else {
    document.delete("run_id");
  }
}
function stripLegacyRunFields(document) {
  const LEGACY_RUN_KEYS = [
    "skill",
    "skill_version",
    "skill_hash",
    "orchestration",
    "current_step",
    "iteration",
    "pending",
    "pending_ref",
    "trajectory_ref",
    "context_ref",
    "artifacts_ref",
    "checkpoint_ref",
    "run_status",
    "run_retries"
  ];
  for (const key of LEGACY_RUN_KEYS) document.delete(key);
}
function stripLegacyCommandFields(document) {
  let changed = false;
  for (const key of ["build_command", "verify_command"]) {
    if (document.has(key)) {
      document.delete(key);
      changed = true;
    }
  }
  return changed;
}
async function readDocument(file) {
  let source;
  try {
    source = (await readProtectedProjectFile(
      path12.dirname(file),
      path12.basename(file),
      CLASSIC_STATE_MAX_BYTES,
      {
        label: "Classic state document"
      }
    )).bytes.toString("utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return new import_yaml3.Document({});
  }
  const document = (0, import_yaml3.parseDocument)(source);
  if (document.errors.length > 0) {
    throw new Error(`Invalid Classic state document: ${document.errors[0].message}`);
  }
  documentRecord(document);
  return document;
}
async function readClassicState(changeDir, options = {}) {
  const shouldMigrate = options.migrate !== false;
  const file = path12.join(changeDir, ".comet.yaml");
  const document = await readDocument(file);
  let doc = documentRecord(document);
  let migrated = stripLegacyCommandFields(document);
  if (migrated) doc = documentRecord(document);
  let run = await readRunState(changeDir);
  if (!run && doc.run_id && doc.skill) {
    const { runStateFromDocument: runStateFromDocument2 } = await Promise.resolve().then(() => (init_state(), state_exports));
    run = runStateFromDocument2(doc);
    if (run && shouldMigrate) {
      await writeRunState(changeDir, run);
      stripLegacyRunFields(document);
      migrated = true;
    }
  }
  if (migrated && shouldMigrate) {
    await atomicWriteContainedText(file, document.toString(), { containedRoot: changeDir });
  }
  return parseClassicStateDocument(documentRecord(document), run);
}
async function readLegacyState(changeDir) {
  const document = await readDocument(path12.join(changeDir, ".comet.yaml"));
  return readLegacyStateSummary(documentRecord(document));
}
async function writeClassicState(changeDir, projection, options = {}) {
  const file = path12.join(changeDir, ".comet.yaml");
  const document = await readDocument(file);
  applyProjection(document, {
    ...projection,
    unknownKeys: projection.unknownKeys ?? []
  });
  parseClassicStateDocument(documentRecord(document), projection.run ?? null);
  await atomicWriteContainedText(file, document.toString(), {
    containedRoot: changeDir,
    beforeCommit: options.beforeCommit
  });
  if (projection.run) {
    await writeRunState(changeDir, projection.run);
  } else {
    await removeRunState(changeDir);
  }
}

// domains/engine/loop.ts
function startRun(pkg, runId, skillHash) {
  return {
    runId,
    skill: pkg.definition.metadata.name,
    skillVersion: pkg.definition.metadata.version,
    skillHash,
    orchestration: pkg.definition.orchestration.mode,
    currentStep: pkg.definition.orchestration.entry ?? null,
    iteration: 0,
    pending: null,
    pendingRef: ".comet/pending-action.json",
    trajectoryRef: ".comet/trajectory.jsonl",
    contextRef: ".comet/context.md",
    artifactsRef: ".comet/artifacts.json",
    checkpointRef: ".comet/checkpoint.json",
    status: "running",
    retries: {}
  };
}

// domains/engine/run-store.ts
init_protected_run_file();
import path13 from "path";
var RUN_FILE_LIMITS = {
  trajectory: 8 * 1024 * 1024,
  artifacts: 1024 * 1024,
  context: 1024 * 1024,
  pendingAction: 256 * 1024,
  checkpoint: 256 * 1024
};
function assertRunPath(changeDir, relativePath2) {
  if (path13.isAbsolute(relativePath2)) {
    throw new Error("Run path must stay inside the change directory");
  }
  const root = path13.resolve(changeDir);
  const target = path13.resolve(root, relativePath2);
  if (target !== root && !target.startsWith(root + path13.sep)) {
    throw new Error("Run path must stay inside the change directory");
  }
}
async function appendTrajectory(changeDir, relativePath2, event, options = {}) {
  assertRunPath(changeDir, relativePath2);
  await appendEngineRunText(
    changeDir,
    relativePath2,
    `${JSON.stringify(event)}
`,
    RUN_FILE_LIMITS.trajectory,
    "Run trajectory",
    options
  );
}
async function readTrajectory(changeDir, relativePath2, options = {}) {
  assertRunPath(changeDir, relativePath2);
  const raw = await readOptionalEngineRunText(
    changeDir,
    relativePath2,
    RUN_FILE_LIMITS.trajectory,
    "Run trajectory",
    options
  );
  if (raw === null) return [];
  return raw.split(/\r?\n/).map((line, index) => ({ line, number: index + 1 })).filter(({ line }) => line.length > 0).map(({ line, number }) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid Trajectory event at line ${number}`, { cause: error });
    }
  });
}
async function readArtifacts(changeDir, relativePath2, options = {}) {
  assertRunPath(changeDir, relativePath2);
  const raw = await readOptionalEngineRunText(
    changeDir,
    relativePath2,
    RUN_FILE_LIMITS.artifacts,
    "Run artifacts",
    options
  );
  return raw === null ? {} : JSON.parse(raw);
}
async function writeArtifacts(changeDir, relativePath2, artifacts, options = {}) {
  assertRunPath(changeDir, relativePath2);
  await writeEngineRunText(
    changeDir,
    relativePath2,
    JSON.stringify(artifacts, null, 2) + "\n",
    RUN_FILE_LIMITS.artifacts,
    "Run artifacts",
    options
  );
}
async function writeContext(changeDir, relativePath2, context, options = {}) {
  assertRunPath(changeDir, relativePath2);
  await writeEngineRunText(
    changeDir,
    relativePath2,
    context,
    RUN_FILE_LIMITS.context,
    "Run context",
    options
  );
}
async function readContext(changeDir, relativePath2, options = {}) {
  assertRunPath(changeDir, relativePath2);
  return readOptionalEngineRunText(
    changeDir,
    relativePath2,
    RUN_FILE_LIMITS.context,
    "Run context",
    options
  );
}
async function writePendingAction(changeDir, relativePath2, action, options = {}) {
  assertRunPath(changeDir, relativePath2);
  await writeEngineRunText(
    changeDir,
    relativePath2,
    JSON.stringify(action, null, 2) + "\n",
    RUN_FILE_LIMITS.pendingAction,
    "Run pending action",
    options
  );
}
async function readPendingAction(changeDir, relativePath2, options = {}) {
  assertRunPath(changeDir, relativePath2);
  const raw = await readOptionalEngineRunText(
    changeDir,
    relativePath2,
    RUN_FILE_LIMITS.pendingAction,
    "Run pending action",
    options
  );
  return raw === null ? null : JSON.parse(raw);
}
async function clearPendingAction(changeDir, relativePath2, options = {}) {
  assertRunPath(changeDir, relativePath2);
  await removeEngineRunFile(changeDir, relativePath2, "Run pending action", options);
}
async function writeCheckpoint(changeDir, relativePath2, checkpoint, options = {}) {
  assertRunPath(changeDir, relativePath2);
  await writeEngineRunText(
    changeDir,
    relativePath2,
    JSON.stringify(checkpoint, null, 2) + "\n",
    RUN_FILE_LIMITS.checkpoint,
    "Run checkpoint",
    options
  );
}
async function readCheckpoint(changeDir, relativePath2, options = {}) {
  assertRunPath(changeDir, relativePath2);
  const raw = await readOptionalEngineRunText(
    changeDir,
    relativePath2,
    RUN_FILE_LIMITS.checkpoint,
    "Run checkpoint",
    options
  );
  return raw === null ? null : JSON.parse(raw);
}

// domains/skill/snapshot.ts
import { createHash as createHash4, randomUUID as randomUUID4 } from "crypto";
import { promises as fs11 } from "fs";
import path16 from "path";

// domains/skill/load.ts
var import_yaml4 = __toESM(require_dist(), 1);
import { promises as fs10 } from "fs";
import path14 from "path";
var ACTION_TYPES = ["invoke_skill", "call_tool", "handoff", "ask_user", "checkpoint"];
var ORCHESTRATION_MODES = ["deterministic", "adaptive"];
var TOOL_KINDS = ["function", "mcp", "script", "agent"];
var TOOL_SIDE_EFFECTS = ["none", "read", "write", "external"];
var EVAL_SCOPES = ["progress", "step", "completion"];
var EVAL_TYPES = ["artifact_exists", "state_equals"];
function invalidDocument(filePath, fieldPath, message) {
  return new Error(`${filePath}: ${fieldPath} ${message}`);
}
function assertObject(value, filePath, fieldPath = "document") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalidDocument(filePath, fieldPath, "must be an object");
  }
}
function assertArray(value, filePath, fieldPath) {
  if (!Array.isArray(value)) {
    throw invalidDocument(filePath, fieldPath, "must be an array");
  }
}
function assertString(value, filePath, fieldPath) {
  if (typeof value !== "string") {
    throw invalidDocument(filePath, fieldPath, "must be a string");
  }
}
function assertOptionalString(document, field2, filePath, objectPath) {
  if (field2 in document) {
    assertString(document[field2], filePath, `${objectPath}.${field2}`);
  }
}
function assertOptionalBoolean(document, field2, filePath, objectPath) {
  if (field2 in document && typeof document[field2] !== "boolean") {
    throw invalidDocument(filePath, `${objectPath}.${field2}`, "must be a boolean");
  }
}
function assertEnum(value, values, filePath, fieldPath) {
  if (typeof value !== "string" || !values.includes(value)) {
    throw invalidDocument(filePath, fieldPath, `must be one of ${values.join(", ")}`);
  }
}
function assertStringArray(value, filePath, fieldPath) {
  assertArray(value, filePath, fieldPath);
  value.forEach((entry2, index) => {
    assertString(entry2, filePath, `${fieldPath}[${index}]`);
  });
}
function validateNamedContract(value, filePath, fieldPath) {
  assertObject(value, filePath, fieldPath);
  assertString(value.name, filePath, `${fieldPath}.name`);
  assertString(value.description, filePath, `${fieldPath}.description`);
  assertOptionalBoolean(value, "required", filePath, fieldPath);
}
function validateSkillReference(value, filePath, fieldPath) {
  assertObject(value, filePath, fieldPath);
  assertString(value.id, filePath, `${fieldPath}.id`);
  assertOptionalString(value, "source", filePath, fieldPath);
  assertOptionalString(value, "version", filePath, fieldPath);
}
function validateAgent(value, filePath, fieldPath) {
  assertObject(value, filePath, fieldPath);
  assertString(value.id, filePath, `${fieldPath}.id`);
  assertString(value.role, filePath, `${fieldPath}.role`);
  assertOptionalString(value, "instructions", filePath, fieldPath);
}
function validateTool(value, filePath, fieldPath) {
  assertObject(value, filePath, fieldPath);
  assertString(value.id, filePath, `${fieldPath}.id`);
  assertEnum(value.kind, TOOL_KINDS, filePath, `${fieldPath}.kind`);
  assertString(value.source, filePath, `${fieldPath}.source`);
  assertEnum(value.sideEffect, TOOL_SIDE_EFFECTS, filePath, `${fieldPath}.sideEffect`);
  assertOptionalBoolean(value, "requiresConfirmation", filePath, fieldPath);
}
function validateAction(value, filePath, fieldPath) {
  assertObject(value, filePath, fieldPath);
  assertEnum(value.type, ACTION_TYPES, filePath, `${fieldPath}.type`);
  assertOptionalString(value, "ref", filePath, fieldPath);
  assertOptionalString(value, "prompt", filePath, fieldPath);
  assertOptionalString(value, "question", filePath, fieldPath);
  if ("options" in value) {
    assertStringArray(value.options, filePath, `${fieldPath}.options`);
  }
}
function validateStep(value, filePath, fieldPath) {
  assertObject(value, filePath, fieldPath);
  assertString(value.id, filePath, `${fieldPath}.id`);
  validateAction(value.action, filePath, `${fieldPath}.action`);
  assertOptionalString(value, "next", filePath, fieldPath);
  if ("completionEvals" in value) {
    assertStringArray(value.completionEvals, filePath, `${fieldPath}.completionEvals`);
  }
}
function validateGoal(value, filePath) {
  const fieldPath = "goal";
  assertObject(value, filePath, fieldPath);
  assertString(value.statement, filePath, `${fieldPath}.statement`);
  assertArray(value.inputs, filePath, `${fieldPath}.inputs`);
  value.inputs.forEach((entry2, index) => {
    validateNamedContract(entry2, filePath, `${fieldPath}.inputs[${index}]`);
  });
  assertArray(value.outputs, filePath, `${fieldPath}.outputs`);
  value.outputs.forEach((entry2, index) => {
    validateNamedContract(entry2, filePath, `${fieldPath}.outputs[${index}]`);
  });
  assertStringArray(value.success, filePath, `${fieldPath}.success`);
}
function validateOrchestration(value, filePath) {
  const fieldPath = "orchestration";
  assertObject(value, filePath, fieldPath);
  assertEnum(value.mode, ORCHESTRATION_MODES, filePath, `${fieldPath}.mode`);
  assertOptionalString(value, "entry", filePath, fieldPath);
  if ("steps" in value) {
    assertArray(value.steps, filePath, `${fieldPath}.steps`);
    value.steps.forEach((entry2, index) => {
      validateStep(entry2, filePath, `${fieldPath}.steps[${index}]`);
    });
  }
}
function narrowSkillDefinition(document, filePath) {
  assertObject(document, filePath);
  assertEnum(document.apiVersion, ["comet/v1alpha1"], filePath, "apiVersion");
  assertEnum(document.kind, ["Skill"], filePath, "kind");
  assertObject(document.metadata, filePath, "metadata");
  assertString(document.metadata.name, filePath, "metadata.name");
  assertString(document.metadata.version, filePath, "metadata.version");
  assertString(document.metadata.description, filePath, "metadata.description");
  validateGoal(document.goal, filePath);
  validateOrchestration(document.orchestration, filePath);
  assertArray(document.skills, filePath, "skills");
  document.skills.forEach((entry2, index) => {
    validateSkillReference(entry2, filePath, `skills[${index}]`);
  });
  assertArray(document.agents, filePath, "agents");
  document.agents.forEach((entry2, index) => {
    validateAgent(entry2, filePath, `agents[${index}]`);
  });
  assertArray(document.tools, filePath, "tools");
  document.tools.forEach((entry2, index) => {
    validateTool(entry2, filePath, `tools[${index}]`);
  });
  return document;
}
function narrowGuardrails(document, filePath) {
  assertObject(document, filePath);
  for (const field2 of [
    "allowedSkills",
    "allowedAgents",
    "allowedTools",
    "confirmationRequiredFor"
  ]) {
    if (field2 in document) {
      assertStringArray(document[field2], filePath, field2);
    }
  }
  for (const field2 of ["maxIterations", "maxRetriesPerAction"]) {
    if (field2 in document && (typeof document[field2] !== "number" || !Number.isFinite(document[field2]))) {
      throw invalidDocument(filePath, field2, "must be a finite number");
    }
  }
  return document;
}
function narrowEvalDocument(document, filePath) {
  assertObject(document, filePath);
  if ("runtime" in document) {
    narrowRuntimeEvals(document.runtime, filePath, "runtime");
  }
  return document;
}
function narrowRuntimeEvals(value, filePath, fieldPath) {
  assertArray(value, filePath, fieldPath);
  value.forEach((entry2, index) => {
    const itemPath = `${fieldPath}[${index}]`;
    assertObject(entry2, filePath, itemPath);
    assertString(entry2.id, filePath, `${itemPath}.id`);
    assertEnum(entry2.scope, EVAL_SCOPES, filePath, `${itemPath}.scope`);
    assertEnum(entry2.type, EVAL_TYPES, filePath, `${itemPath}.type`);
    assertOptionalString(entry2, "artifact", filePath, itemPath);
    assertOptionalString(entry2, "field", filePath, itemPath);
    assertOptionalString(entry2, "equals", filePath, itemPath);
  });
  return value;
}
async function readYaml(filePath) {
  const source = await fs10.readFile(filePath, "utf8");
  try {
    return (0, import_yaml4.parse)(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw invalidDocument(filePath, "document", message);
  }
}
async function readOptionalYaml(filePath) {
  try {
    return await readYaml(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
async function yamlFileExists(filePath) {
  try {
    await fs10.access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
async function readRuntimeChecks(cometRoot) {
  const checksPath = path14.join(cometRoot, "checks.yaml");
  const evalsPath = path14.join(cometRoot, "evals.yaml");
  const [hasChecks, hasEvals] = await Promise.all([
    yamlFileExists(checksPath),
    yamlFileExists(evalsPath)
  ]);
  if (hasEvals) {
    throw new Error(`${evalsPath}: evals.yaml is no longer supported; use checks.yaml`);
  }
  if (hasChecks) {
    return {
      document: narrowEvalDocument(await readYaml(checksPath), checksPath)
    };
  }
  return { document: null };
}
async function loadPackageFromLayout(options) {
  const packageRoot = path14.resolve(options.root);
  const controlRoot = path14.resolve(options.controlRoot);
  if (options.requireSkillMarkdown) {
    await fs10.access(path14.join(packageRoot, "SKILL.md"));
  }
  const skillPath = path14.join(controlRoot, "skill.yaml");
  const guardrailsPath = path14.join(controlRoot, "guardrails.yaml");
  const definition = narrowSkillDefinition(await readYaml(skillPath), skillPath);
  const rawGuardrails = await readOptionalYaml(guardrailsPath);
  const guardrailDocument = rawGuardrails === null ? null : narrowGuardrails(rawGuardrails, guardrailsPath);
  const runtimeChecks = await readRuntimeChecks(controlRoot);
  const defaultGuardrails = {
    allowedSkills: definition.skills.map((skill) => skill.id),
    allowedAgents: definition.agents.map((agent) => agent.id),
    allowedTools: definition.tools.map((tool) => tool.id),
    maxIterations: 50,
    maxRetriesPerAction: 3,
    confirmationRequiredFor: definition.tools.filter((tool) => tool.requiresConfirmation).map((tool) => tool.id)
  };
  return {
    root: packageRoot,
    packageKind: options.packageKind === "runtime" ? "runtime" : void 0,
    definition,
    guardrails: {
      ...defaultGuardrails,
      ...guardrailDocument
    },
    evals: runtimeChecks.document?.runtime ?? []
  };
}
async function loadSkillPackage(root) {
  const packageRoot = path14.resolve(root);
  return loadPackageFromLayout({
    root: packageRoot,
    controlRoot: path14.join(packageRoot, "comet"),
    packageKind: "skill",
    requireSkillMarkdown: true
  });
}
async function loadRuntimePackage(root) {
  const packageRoot = path14.resolve(root);
  return loadPackageFromLayout({
    root: packageRoot,
    controlRoot: packageRoot,
    packageKind: "runtime",
    requireSkillMarkdown: false
  });
}
function loadSkillPackageDocument(document, root, filePath = path14.join(root, "package.json")) {
  assertObject(document, filePath);
  const packageKind = document.packageKind === "runtime" ? "runtime" : void 0;
  const definition = narrowSkillDefinition(document.definition, filePath);
  const guardrailDocument = narrowGuardrails(document.guardrails, filePath);
  const evals = narrowRuntimeEvals(document.evals, filePath, "evals");
  const defaultGuardrails = {
    allowedSkills: definition.skills.map((skill) => skill.id),
    allowedAgents: definition.agents.map((agent) => agent.id),
    allowedTools: definition.tools.map((tool) => tool.id),
    maxIterations: 50,
    maxRetriesPerAction: 3,
    confirmationRequiredFor: definition.tools.filter((tool) => tool.requiresConfirmation).map((tool) => tool.id)
  };
  return {
    root: path14.resolve(root),
    packageKind,
    definition,
    guardrails: {
      ...defaultGuardrails,
      ...guardrailDocument
    },
    evals
  };
}

// domains/skill/validate.ts
import path15 from "path";
function validatesAction(action, pkg, errors, stepId) {
  if (action.type === "invoke_skill" && !pkg.definition.skills.some((item) => item.id === action.ref)) {
    errors.push(`step ${stepId} references undeclared skill: ${action.ref ?? "(missing)"}`);
  }
  if (action.type === "call_tool" && !pkg.definition.tools.some((item) => item.id === action.ref)) {
    errors.push(`step ${stepId} references undeclared tool: ${action.ref ?? "(missing)"}`);
  }
  if (action.type === "handoff" && !pkg.definition.agents.some((item) => item.id === action.ref)) {
    errors.push(`step ${stepId} references undeclared agent: ${action.ref ?? "(missing)"}`);
  }
  if (action.type === "ask_user" && !action.question) {
    errors.push(`step ${stepId} ask_user action requires question`);
  }
}
function validateSkillPackage(pkg) {
  const errors = [];
  const { definition, guardrails, evals } = pkg;
  if (definition.apiVersion !== "comet/v1alpha1") errors.push("unsupported apiVersion");
  if (definition.kind !== "Skill") errors.push("kind must be Skill");
  if (!definition.metadata.name) errors.push("metadata.name is required");
  if (!definition.goal.statement) errors.push("goal.statement is required");
  if (guardrails.maxIterations < 1) errors.push("maxIterations must be at least 1");
  if (guardrails.maxRetriesPerAction < 0) errors.push("maxRetriesPerAction must not be negative");
  const steps = definition.orchestration.steps ?? [];
  if (definition.orchestration.mode === "adaptive") {
    if (definition.orchestration.entry || steps.length > 0) {
      errors.push("adaptive orchestration must not define entry or steps");
    }
  } else {
    const ids = /* @__PURE__ */ new Set();
    for (const step of steps) {
      if (ids.has(step.id)) errors.push(`duplicate step id: ${step.id}`);
      ids.add(step.id);
      validatesAction(step.action, pkg, errors, step.id);
    }
    if (!definition.orchestration.entry || !ids.has(definition.orchestration.entry)) {
      errors.push(
        `orchestration.entry references unknown step: ${definition.orchestration.entry ?? "(missing)"}`
      );
    }
    for (const step of steps) {
      if (step.next && !ids.has(step.next))
        errors.push(`step ${step.id} has unknown next step: ${step.next}`);
      for (const evalId of step.completionEvals ?? []) {
        if (!evals.some((item) => item.id === evalId)) {
          errors.push(`step ${step.id} references unknown eval: ${evalId}`);
        }
      }
    }
  }
  for (const tool of definition.tools) {
    if (tool.kind !== "script") continue;
    const normalized2 = path15.posix.normalize(tool.source.replaceAll("\\", "/"));
    if (path15.isAbsolute(tool.source) || normalized2 === ".." || normalized2.startsWith("../")) {
      errors.push(`script tool ${tool.id} must reference a relative path inside the Skill package`);
    }
  }
  for (const id of guardrails.allowedSkills) {
    if (!definition.skills.some((item) => item.id === id))
      errors.push(`guardrails allow undeclared skill: ${id}`);
  }
  for (const id of guardrails.allowedAgents) {
    if (!definition.agents.some((item) => item.id === id))
      errors.push(`guardrails allow undeclared agent: ${id}`);
  }
  for (const id of guardrails.allowedTools) {
    if (!definition.tools.some((item) => item.id === id))
      errors.push(`guardrails allow undeclared tool: ${id}`);
  }
  return errors;
}

// domains/skill/snapshot.ts
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)])
    );
  }
  return value;
}
function packageDocument(pkg) {
  return stable({
    ...pkg.packageKind === "runtime" ? { packageKind: "runtime" } : {},
    definition: pkg.definition,
    guardrails: pkg.guardrails,
    evals: pkg.evals
  });
}
function normalizedRelativePath(source) {
  return path16.posix.normalize(source.replaceAll("\\", "/"));
}
function assertInside(parent, target, label) {
  const relative = path16.relative(parent, target);
  if (relative === "" || !path16.isAbsolute(relative) && !relative.startsWith(`..${path16.sep}`)) {
    return;
  }
  throw new Error(`${label} resolves outside the Skill package`);
}
async function readPackageFile(root, relativePath2, label) {
  const normalized2 = normalizedRelativePath(relativePath2);
  if (path16.posix.isAbsolute(normalized2) || normalized2 === ".." || normalized2.startsWith("../")) {
    throw new Error(`${label} resolves outside the Skill package`);
  }
  const target = path16.resolve(root, ...normalized2.split("/"));
  assertInside(root, target, label);
  let realTarget;
  try {
    realTarget = await fs11.realpath(target);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`${label} does not exist: ${relativePath2}`, { cause: error });
    }
    throw error;
  }
  assertInside(root, realTarget, label);
  if (!(await fs11.stat(realTarget)).isFile()) {
    throw new Error(`${label} is not a file: ${relativePath2}`);
  }
  return { path: normalized2, content: await fs11.readFile(realTarget) };
}
async function snapshotFiles(pkg) {
  const root = await fs11.realpath(pkg.root);
  const files = pkg.packageKind === "runtime" ? [] : [await readPackageFile(root, "SKILL.md", "SKILL.md")];
  for (const tool of pkg.definition.tools) {
    if (tool.kind !== "script") continue;
    files.push(await readPackageFile(root, tool.source, `Script tool ${tool.id}`));
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}
function hashSnapshot(document, files) {
  const fileDigests = files.map((file) => ({
    path: file.path,
    sha256: createHash4("sha256").update(file.content).digest("hex")
  }));
  return createHash4("sha256").update(JSON.stringify(stable({ package: document, files: fileDigests }))).digest("hex");
}
function packageJson(document) {
  return JSON.stringify(document, null, 2) + "\n";
}
async function snapshotMaterial(pkg) {
  const document = packageDocument(pkg);
  const files = await snapshotFiles(pkg);
  return { document, files, hash: hashSnapshot(document, files) };
}
async function hashSkillPackage(pkg) {
  return (await snapshotMaterial(pkg)).hash;
}
async function pathExists(target) {
  try {
    await fs11.access(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function verifyPublishedSnapshot(snapshotDir, material) {
  try {
    const storedHash = (await fs11.readFile(path16.join(snapshotDir, "sha256"), "utf8")).trim();
    if (storedHash !== material.hash) throw new Error("hash mismatch");
    const storedPackage = await fs11.readFile(path16.join(snapshotDir, "package.json"), "utf8");
    if (storedPackage !== packageJson(material.document)) throw new Error("package mismatch");
    for (const file of material.files) {
      const stored = await fs11.readFile(path16.join(snapshotDir, ...file.path.split("/")));
      if (!stored.equals(file.content)) throw new Error(`file mismatch: ${file.path}`);
    }
  } catch (error) {
    throw new Error(`Existing Skill snapshot is invalid: ${material.hash}`, { cause: error });
  }
}
async function createSkillSnapshot(pkg, changeDir) {
  const material = await snapshotMaterial(pkg);
  const snapshotsRoot = path16.resolve(changeDir, ".comet", "skill-snapshots");
  const snapshotDir = path16.join(snapshotsRoot, material.hash);
  await fs11.mkdir(snapshotsRoot, { recursive: true });
  if (await pathExists(snapshotDir)) {
    await verifyPublishedSnapshot(snapshotDir, material);
    return { hash: material.hash, snapshotDir };
  }
  const temporaryDir = path16.join(snapshotsRoot, `.tmp-${randomUUID4()}`);
  assertInside(snapshotsRoot, temporaryDir, "Temporary snapshot");
  assertInside(snapshotsRoot, snapshotDir, "Published snapshot");
  try {
    await fs11.mkdir(temporaryDir);
    for (const file of material.files) {
      const destination = path16.join(temporaryDir, ...file.path.split("/"));
      assertInside(temporaryDir, destination, `Snapshot file ${file.path}`);
      await fs11.mkdir(path16.dirname(destination), { recursive: true });
      await fs11.writeFile(destination, file.content);
    }
    await fs11.writeFile(path16.join(temporaryDir, "package.json"), packageJson(material.document));
    await fs11.writeFile(path16.join(temporaryDir, "sha256"), material.hash + "\n");
    await fs11.rename(temporaryDir, snapshotDir);
  } catch (error) {
    if (await pathExists(snapshotDir)) {
      try {
        await verifyPublishedSnapshot(snapshotDir, material);
      } finally {
        await fs11.rm(temporaryDir, { recursive: true, force: true });
      }
      return { hash: material.hash, snapshotDir };
    }
    await fs11.rm(temporaryDir, { recursive: true, force: true });
    throw error;
  }
  return { hash: material.hash, snapshotDir };
}
async function readSkillSnapshot(changeDir, hash) {
  if (!/^[a-f0-9]{64}$/u.test(hash)) {
    throw new Error(`Invalid Skill snapshot hash: ${hash}`);
  }
  const snapshotsRoot = path16.resolve(changeDir, ".comet", "skill-snapshots");
  const snapshotDir = path16.join(snapshotsRoot, hash);
  assertInside(snapshotsRoot, snapshotDir, "Skill snapshot");
  try {
    const storedHash = (await fs11.readFile(path16.join(snapshotDir, "sha256"), "utf8")).trim();
    if (storedHash !== hash) {
      throw new Error(`stored hash is ${storedHash || "(empty)"}`);
    }
    const packagePath = path16.join(snapshotDir, "package.json");
    const document = JSON.parse(await fs11.readFile(packagePath, "utf8"));
    const pkg = loadSkillPackageDocument(document, snapshotDir, packagePath);
    const errors = validateSkillPackage(pkg);
    if (errors.length > 0) {
      throw new Error(errors.map((error) => `  - ${error}`).join("\n"));
    }
    const calculated = await hashSkillPackage(pkg);
    if (calculated !== hash) {
      throw new Error(`calculated hash is ${calculated}`);
    }
    return pkg;
  } catch (error) {
    throw new Error(`Skill snapshot is invalid or missing: ${hash}`, { cause: error });
  }
}

// domains/comet-classic/classic-migrate.ts
async function pathExists2(target) {
  try {
    await fs12.access(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
function sha2563(content) {
  return createHash5("sha256").update(content).digest("hex");
}
function artifactHash(artifacts) {
  return sha2563(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(artifacts).sort(([left], [right]) => left.localeCompare(right))
      )
    )
  );
}
function artifactKey(code) {
  return code.replaceAll(".", "_").replaceAll("-", "_");
}
async function migrationArtifacts(changeDir, evidence) {
  const projectRoot = await discoverClassicProject(changeDir);
  const artifacts = Object.fromEntries(
    evidence.filter((item) => item.satisfied && item.source).map((item) => [artifactKey(item.code), item.source])
  );
  const progress = path17.join(changeDir, "subagent-progress.md");
  if (await pathExists2(progress)) {
    artifacts.subagent_progress = path17.relative(projectRoot, progress).split(path17.sep).join("/");
  }
  const handoff = evidence.find((item) => item.code === "design.handoff" && item.satisfied);
  if (handoff?.source) artifacts.handoff_context = handoff.source;
  return artifacts;
}
function migrationEvents(run, profile, timestamp) {
  return [
    {
      sequence: 1,
      timestamp,
      type: "run_started",
      runId: run.runId,
      data: {
        skill: run.skill,
        skillVersion: run.skillVersion,
        skillHash: run.skillHash
      }
    },
    {
      sequence: 2,
      timestamp,
      type: "state_migrated",
      runId: run.runId,
      data: {
        kind: "classic",
        migrationVersion: CLASSIC_MIGRATION_VERSION,
        profile,
        source: "pre-migration"
      }
    }
  ];
}
async function removeCreatedFiles(files) {
  await Promise.all(files.map((file) => fs12.rm(file, { recursive: true, force: true })));
}
async function ensureClassicRun(changeDir, options) {
  const projection = await readClassicState(changeDir);
  if (!projection.classic) {
    throw new Error("Classic migration requires a legacy state projection");
  }
  const classic = projection.classic;
  const profile = classic.classicProfile ?? classic.workflow;
  if (projection.run) {
    if (classic.classicMigration !== CLASSIC_MIGRATION_VERSION) {
      throw new Error("Classic Run exists without a supported classic_migration marker");
    }
    if (projection.run.skill !== options.skillPackage.definition.metadata.name) {
      throw new Error(
        `Classic Run skill mismatch: expected ${options.skillPackage.definition.metadata.name}, got ${projection.run.skill}`
      );
    }
    const installedHash = await hashSkillPackage(options.skillPackage);
    if (installedHash !== projection.run.skillHash) {
      await readSkillSnapshot(changeDir, projection.run.skillHash);
      return {
        classic,
        run: projection.run,
        evidence: await collectClassicEvidence(changeDir, projection),
        migrated: false,
        snapshotDir: path17.join(changeDir, ".comet", "skill-snapshots", projection.run.skillHash)
      };
    }
    const snapshot = await createSkillSnapshot(options.skillPackage, changeDir);
    return {
      classic,
      run: projection.run,
      evidence: await collectClassicEvidence(changeDir, projection),
      migrated: false,
      snapshotDir: snapshot.snapshotDir
    };
  }
  const evidence = await collectClassicEvidence(changeDir, projection);
  const step = resolveClassicStepId(classic, evidence);
  if (!options.skillPackage.definition.orchestration.steps?.some((item) => item.id === step)) {
    throw new Error(`Classic Skill package does not define resolved step: ${step}`);
  }
  const expectedHash = await hashSkillPackage(options.skillPackage);
  const expectedSnapshotDir = path17.join(changeDir, ".comet", "skill-snapshots", expectedHash);
  const snapshotExisted = await pathExists2(expectedSnapshotDir);
  const createdFiles = [];
  try {
    const snapshot = await createSkillSnapshot(options.skillPackage, changeDir);
    const run = startRun(options.skillPackage, options.runId?.() ?? randomUUID5(), snapshot.hash);
    run.currentStep = step;
    if (step === "completed") run.status = "completed";
    const migratedClassic = {
      ...classic,
      classicProfile: profile,
      classicMigration: CLASSIC_MIGRATION_VERSION
    };
    const artifacts = await migrationArtifacts(changeDir, evidence);
    const projectRoot = await discoverClassicProject(changeDir);
    const handoff = evidence.find((item) => item.code === "design.handoff" && item.satisfied);
    let context = null;
    if (handoff?.source) {
      context = await readClassicProjectFile(
        projectRoot,
        handoff.resolvedSource ?? handoff.source,
        {
          label: "Classic migration handoff context",
          hooks: options.handoffReadHooks
        }
      );
      await writeContext(changeDir, run.contextRef, context);
      createdFiles.push(path17.resolve(changeDir, run.contextRef));
    }
    await writeArtifacts(changeDir, run.artifactsRef, artifacts);
    createdFiles.push(path17.resolve(changeDir, run.artifactsRef));
    const timestamp = (options.now?.() ?? /* @__PURE__ */ new Date()).toISOString();
    const checkpoint = {
      runId: run.runId,
      stateVersion: 1,
      trajectoryOffset: 2,
      contextHash: context === null ? null : sha2563(context),
      artifactsHash: artifactHash(artifacts),
      createdAt: timestamp
    };
    await writeCheckpoint(changeDir, run.checkpointRef, checkpoint);
    createdFiles.push(path17.resolve(changeDir, run.checkpointRef));
    createdFiles.push(path17.resolve(changeDir, run.trajectoryRef));
    for (const event of migrationEvents(run, profile, timestamp)) {
      await appendTrajectory(changeDir, run.trajectoryRef, event);
    }
    await writeClassicState(changeDir, {
      classic: migratedClassic,
      run,
      unknownKeys: projection.unknownKeys
    });
    return {
      classic: migratedClassic,
      run,
      evidence,
      migrated: true,
      snapshotDir: snapshot.snapshotDir
    };
  } catch (error) {
    await removeCreatedFiles(createdFiles);
    if (!snapshotExisted) await fs12.rm(expectedSnapshotDir, { recursive: true, force: true });
    throw error;
  }
}

// domains/comet-classic/classic-runtime-run.ts
async function directoryExists(directory) {
  try {
    return (await fs13.stat(directory)).isDirectory();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function fileExists2(file) {
  try {
    return (await fs13.stat(file)).isFile();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function isClassicRuntimePackageRoot(root) {
  if (!await directoryExists(root)) return false;
  if (await fileExists2(path18.join(root, "skill.yaml"))) return true;
  return await fileExists2(path18.join(root, "SKILL.md")) && await fileExists2(path18.join(root, "comet", "skill.yaml"));
}
function embeddedClassicRuntimePackage(root) {
  return {
    root,
    packageKind: "runtime",
    definition: {
      apiVersion: "comet/v1alpha1",
      kind: "Skill",
      metadata: {
        name: "comet-classic",
        version: "1",
        description: "Internal compatibility orchestration for classic Comet full, hotfix, and tweak workflows"
      },
      goal: {
        statement: "Advance or restore a classic Comet Run without changing the user command surface",
        inputs: [
          {
            name: "classic-state",
            description: "Validated ClassicState consistent with the Run projection",
            required: true
          },
          {
            name: "evidence",
            description: "Structured evidence produced by the Classic Evidence collector",
            required: true
          }
        ],
        outputs: [
          {
            name: "run-state",
            description: "Atomically synchronized Classic and Run state",
            required: true
          }
        ],
        success: [
          "Legacy fields and Run fields remain consistent",
          "Every step invokes only a declared public Comet Skill",
          "The completed state passes its completion eval"
        ]
      },
      orchestration: {
        mode: "deterministic",
        entry: "full.open",
        steps: [
          {
            id: "full.open",
            action: { type: "invoke_skill", ref: "comet-open" },
            next: "full.design.handoff"
          },
          {
            id: "full.design.handoff",
            action: { type: "invoke_skill", ref: "comet-design" },
            next: "full.design.document"
          },
          {
            id: "full.design.document",
            action: { type: "invoke_skill", ref: "comet-design" },
            next: "full.build.plan"
          },
          {
            id: "full.build.plan",
            action: { type: "invoke_skill", ref: "comet-build" },
            next: "full.build.plan-ready"
          },
          {
            id: "full.build.plan-ready",
            action: { type: "invoke_skill", ref: "comet-build" },
            next: "full.build.configure"
          },
          {
            id: "full.build.configure",
            action: { type: "invoke_skill", ref: "comet-build" },
            next: "full.build.execute"
          },
          {
            id: "full.build.execute",
            action: { type: "invoke_skill", ref: "comet-build" },
            next: "full.build.complete"
          },
          {
            id: "full.build.complete",
            action: { type: "invoke_skill", ref: "comet-build" },
            next: "full.verify.run"
          },
          {
            id: "full.build.fix",
            action: { type: "invoke_skill", ref: "comet-build" },
            next: "full.build.execute"
          },
          {
            id: "full.verify.run",
            action: { type: "invoke_skill", ref: "comet-verify" },
            next: "full.verify.branch"
          },
          {
            id: "full.verify.branch",
            action: { type: "invoke_skill", ref: "comet-verify" },
            next: "full.archive.confirm"
          },
          {
            id: "full.archive.confirm",
            action: { type: "invoke_skill", ref: "comet-archive" },
            next: "full.archive.execute"
          },
          {
            id: "full.archive.execute",
            action: { type: "invoke_skill", ref: "comet-archive" },
            next: "completed"
          },
          {
            id: "hotfix.open",
            action: { type: "invoke_skill", ref: "comet-hotfix" },
            next: "hotfix.build.execute"
          },
          {
            id: "hotfix.build.execute",
            action: { type: "invoke_skill", ref: "comet-build" },
            next: "hotfix.build.complete"
          },
          {
            id: "hotfix.build.complete",
            action: { type: "invoke_skill", ref: "comet-build" },
            next: "hotfix.verify.run"
          },
          {
            id: "hotfix.verify.run",
            action: { type: "invoke_skill", ref: "comet-verify" },
            next: "hotfix.verify.branch"
          },
          {
            id: "hotfix.verify.branch",
            action: { type: "invoke_skill", ref: "comet-verify" },
            next: "hotfix.archive.confirm"
          },
          {
            id: "hotfix.archive.confirm",
            action: { type: "invoke_skill", ref: "comet-archive" },
            next: "hotfix.archive.execute"
          },
          {
            id: "hotfix.archive.execute",
            action: { type: "invoke_skill", ref: "comet-archive" },
            next: "completed"
          },
          {
            id: "tweak.open",
            action: { type: "invoke_skill", ref: "comet-tweak" },
            next: "tweak.build.execute"
          },
          {
            id: "tweak.build.execute",
            action: { type: "invoke_skill", ref: "comet-build" },
            next: "tweak.build.complete"
          },
          {
            id: "tweak.build.complete",
            action: { type: "invoke_skill", ref: "comet-build" },
            next: "tweak.verify.run"
          },
          {
            id: "tweak.verify.run",
            action: { type: "invoke_skill", ref: "comet-verify" },
            next: "tweak.verify.branch"
          },
          {
            id: "tweak.verify.branch",
            action: { type: "invoke_skill", ref: "comet-verify" },
            next: "tweak.archive.confirm"
          },
          {
            id: "tweak.archive.confirm",
            action: { type: "invoke_skill", ref: "comet-archive" },
            next: "tweak.archive.execute"
          },
          {
            id: "tweak.archive.execute",
            action: { type: "invoke_skill", ref: "comet-archive" },
            next: "completed"
          },
          {
            id: "completed",
            action: { type: "checkpoint" },
            completionEvals: ["classic-completed"]
          }
        ]
      },
      skills: [
        { id: "comet-open" },
        { id: "comet-design" },
        { id: "comet-build" },
        { id: "comet-verify" },
        { id: "comet-archive" },
        { id: "comet-hotfix" },
        { id: "comet-tweak" }
      ],
      agents: [],
      tools: []
    },
    guardrails: {
      allowedSkills: [
        "comet-open",
        "comet-design",
        "comet-build",
        "comet-verify",
        "comet-archive",
        "comet-hotfix",
        "comet-tweak"
      ],
      allowedAgents: [],
      allowedTools: [],
      maxIterations: 500,
      maxRetriesPerAction: 3,
      confirmationRequiredFor: []
    },
    evals: [
      {
        id: "classic-completed",
        scope: "completion",
        type: "state_equals",
        field: "status",
        equals: "completed"
      }
    ]
  };
}
async function classicRuntimeRoot() {
  const runtimeDirectory = path18.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.COMET_RUNTIME_CLASSIC_ROOT,
    path18.resolve(runtimeDirectory, "..", "runtime", "classic"),
    path18.resolve(runtimeDirectory, "..", "..", "comet", "runtime", "classic"),
    path18.resolve(runtimeDirectory, "..", "..", "assets", "skills", "comet", "runtime", "classic"),
    path18.resolve("assets", "skills", "comet", "runtime", "classic"),
    process.env.COMET_CLASSIC_SKILL_ROOT,
    path18.resolve(runtimeDirectory, "..", "..", "comet-classic"),
    path18.resolve(runtimeDirectory, "..", "..", "assets", "skills", "comet-classic"),
    path18.resolve("assets", "skills", "comet-classic")
  ].filter((candidate) => Boolean(candidate));
  for (const candidate of candidates) {
    if (await isClassicRuntimePackageRoot(candidate)) return candidate;
  }
  return null;
}
async function loadClassicRuntimePackage(root) {
  if (await fileExists2(path18.join(root, "skill.yaml"))) {
    return loadRuntimePackage(root);
  }
  return loadSkillPackage(root);
}
async function ensureClassicRuntimeRun(changeDir) {
  const root = await classicRuntimeRoot();
  return ensureClassicRun(changeDir, {
    skillPackage: root ? await loadClassicRuntimePackage(root) : embeddedClassicRuntimePackage(path18.dirname(fileURLToPath(import.meta.url)))
  });
}
async function ensureStrictClassicRuntimeRun(changeDir) {
  const projection = await readClassicState(changeDir);
  const unknownKeys = Array.from(new Set(projection.unknownKeys)).sort();
  if (unknownKeys.length > 0) {
    throw new Error(`Invalid Classic state: unknown field(s): ${unknownKeys.join(", ")}`);
  }
  return ensureClassicRuntimeRun(changeDir);
}
async function validateClassicRuntimeRun(changeDir, existingProjection) {
  const projection = existingProjection ?? await readClassicState(changeDir, { migrate: false });
  const unknownKeys = Array.from(new Set(projection.unknownKeys)).sort();
  if (unknownKeys.length > 0) {
    throw new Error(`Invalid Classic state: unknown field(s): ${unknownKeys.join(", ")}`);
  }
  if (!projection.classic || !projection.run) {
    throw new Error("Classic runtime validation requires synchronized Classic and Run projections");
  }
  if (projection.classic.classicMigration !== CLASSIC_MIGRATION_VERSION) {
    throw new Error("Classic Run exists without a supported classic_migration marker");
  }
  const root = await classicRuntimeRoot();
  const skillPackage = root ? await loadClassicRuntimePackage(root) : embeddedClassicRuntimePackage(path18.dirname(fileURLToPath(import.meta.url)));
  if (projection.run.skill !== skillPackage.definition.metadata.name) {
    throw new Error(
      `Classic Run skill mismatch: expected ${skillPackage.definition.metadata.name}, got ${projection.run.skill}`
    );
  }
  const snapshot = await readSkillSnapshot(changeDir, projection.run.skillHash);
  if (snapshot.definition.metadata.name !== projection.run.skill) {
    throw new Error(
      `Classic Run snapshot skill mismatch: expected ${projection.run.skill}, got ${snapshot.definition.metadata.name}`
    );
  }
  const evidence = await collectClassicEvidence(changeDir, projection);
  const currentStep = resolveClassicStepId(projection.classic, evidence);
  if (projection.run.currentStep !== currentStep) {
    throw new Error(
      `Classic Run step mismatch: expected ${currentStep}, got ${projection.run.currentStep}`
    );
  }
  return {
    classic: projection.classic,
    run: projection.run,
    evidence,
    migrated: false,
    snapshotDir: path18.join(changeDir, ".comet", "skill-snapshots", projection.run.skillHash)
  };
}
async function transitionClassicRuntimeRun(changeDir, classic, run, data) {
  const projection = await readClassicState(changeDir);
  if (!projection.classic || !projection.run) {
    throw new Error("Classic transition requires synchronized Classic and Run projections");
  }
  const evidence = await collectClassicEvidence(changeDir, {
    classic,
    run,
    unknownKeys: projection.unknownKeys
  });
  const currentStep = resolveClassicStepId(classic, evidence);
  const nextRun = {
    ...run,
    currentStep,
    iteration: run.iteration + 1,
    status: currentStep === "completed" ? "completed" : "running"
  };
  await writeClassicState(changeDir, {
    classic,
    run: nextRun,
    unknownKeys: projection.unknownKeys
  });
  const trajectory = await readTrajectory(changeDir, nextRun.trajectoryRef);
  await appendTrajectory(changeDir, nextRun.trajectoryRef, {
    sequence: trajectory.length + 1,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    type: "state_transitioned",
    runId: nextRun.runId,
    data: {
      kind: "classic",
      fromStep: run.currentStep,
      toStep: currentStep,
      ...data
    }
  });
  return nextRun;
}

// domains/comet-classic/classic-state-events.ts
init_protected_run_file();
import path19 from "path";
var CLASSIC_STATE_EVENT_LOG = path19.join(".comet", "state-events.jsonl");
var CLASSIC_STATE_EVENT_MAX_BYTES = 8 * 1024 * 1024;
async function appendClassicStateEvent(changeDir, input) {
  const record2 = {
    schemaVersion: 1,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    ...input
  };
  await appendEngineRunText(
    changeDir,
    CLASSIC_STATE_EVENT_LOG,
    `${JSON.stringify(record2)}
`,
    CLASSIC_STATE_EVENT_MAX_BYTES,
    "Classic state event log"
  );
  return record2;
}

// domains/comet-classic/classic-transitions.ts
var CLASSIC_TRANSITION_EVENTS = [
  "open-complete",
  "design-complete",
  "build-complete",
  "verify-pass",
  "verify-fail",
  "archive-confirm",
  "archive-reopen",
  "archived",
  "preset-escalate"
];
var CLASSIC_TRANSITION_TABLE = {
  "open-complete": {
    event: "open-complete",
    from: "open",
    guardRefs: ["open-artifacts-present"]
  },
  "design-complete": {
    event: "design-complete",
    from: "design",
    guardRefs: ["design-evidence-present"]
  },
  "build-complete": {
    event: "build-complete",
    from: "build",
    guardRefs: ["build-decisions-selected"]
  },
  "verify-pass": {
    event: "verify-pass",
    from: "verify",
    guardRefs: ["verification-report-present"]
  },
  "verify-fail": {
    event: "verify-fail",
    from: "verify",
    guardRefs: ["verification-failed"]
  },
  "archive-confirm": {
    event: "archive-confirm",
    from: "archive",
    guardRefs: ["archive-final-confirmation"]
  },
  "archive-reopen": {
    event: "archive-reopen",
    from: "archive",
    guardRefs: ["archive-not-finalized"]
  },
  archived: {
    event: "archived",
    from: "archive",
    guardRefs: ["verify-result-pass", "archive-confirmed"]
  },
  "preset-escalate": {
    event: "preset-escalate",
    from: "build",
    guardRefs: ["preset-workflow"]
  }
};
var CLASSIC_GUARD_TRANSITION_EVENT = {
  open: "open-complete",
  design: "design-complete",
  build: "build-complete",
  verify: "verify-pass"
};
function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}
function setField(classic, effects, field2, value) {
  const from = classic[field2];
  classic[field2] = value;
  if (from !== value) effects.push({ field: field2, from, to: value });
}
function applyClassicTransition(current, event, options = {}) {
  const definition = CLASSIC_TRANSITION_TABLE[event];
  if (current.phase !== definition.from) {
    throw new Error(
      `Cannot apply ${event}: phase is '${current.phase}', expected '${definition.from}'`
    );
  }
  const classic = { ...current };
  const effects = [];
  const now = options.now ?? /* @__PURE__ */ new Date();
  if (event === "open-complete") {
    setField(classic, effects, "phase", classic.workflow === "full" ? "design" : "build");
  } else if (event === "design-complete") {
    setField(classic, effects, "phase", "build");
  } else if (event === "build-complete") {
    const preserveEvidence = classic.verifyResult === "fail";
    setField(classic, effects, "phase", "verify");
    setField(classic, effects, "verifyResult", "pending");
    setField(classic, effects, "branchStatus", "pending");
    if (!preserveEvidence) {
      setField(classic, effects, "verificationReport", null);
    }
  } else if (event === "verify-pass") {
    setField(classic, effects, "verifyResult", "pass");
    setField(classic, effects, "verifyFailures", 0);
    setField(classic, effects, "phase", "archive");
    setField(classic, effects, "verifiedAt", dateOnly(now));
    setField(classic, effects, "archiveConfirmation", "pending");
    setField(classic, effects, "branchStatus", "pending");
  } else if (event === "verify-fail") {
    setField(classic, effects, "verifyResult", "fail");
    setField(classic, effects, "verifyFailures", classic.verifyFailures + 1);
    setField(classic, effects, "phase", "build");
    setField(classic, effects, "branchStatus", "pending");
  } else if (event === "preset-escalate") {
    if (classic.workflow !== "hotfix" && classic.workflow !== "tweak") {
      throw new Error(
        `Cannot apply ${event}: workflow must be hotfix or tweak, got '${classic.workflow}'`
      );
    }
    setField(classic, effects, "workflow", "full");
    setField(classic, effects, "classicProfile", "full");
    setField(classic, effects, "phase", "design");
    setField(classic, effects, "designDoc", null);
    setField(classic, effects, "buildPause", null);
    setField(classic, effects, "buildMode", null);
    setField(classic, effects, "subagentDispatch", null);
    setField(classic, effects, "tddMode", null);
    setField(classic, effects, "reviewMode", null);
    setField(classic, effects, "isolation", null);
    setField(classic, effects, "boundBranch", null);
    setField(classic, effects, "verifyMode", null);
    setField(classic, effects, "directOverride", null);
  } else if (event === "archive-confirm") {
    if (classic.verifyResult !== "pass") {
      throw new Error(`Cannot apply ${event}: verifyResult must be pass`);
    }
    if (classic.archived) throw new Error(`Cannot apply ${event}: already archived`);
    setField(classic, effects, "archiveConfirmation", "confirmed");
  } else if (event === "archive-reopen") {
    if (classic.archived) throw new Error(`Cannot apply ${event}: already archived`);
    setField(classic, effects, "verifyResult", "pending");
    setField(classic, effects, "verifyFailures", 0);
    setField(classic, effects, "phase", "verify");
    setField(classic, effects, "verifiedAt", null);
    setField(classic, effects, "archiveConfirmation", null);
    setField(classic, effects, "branchStatus", "pending");
  } else {
    if (classic.verifyResult !== "pass") {
      throw new Error(`Cannot apply ${event}: verifyResult must be pass`);
    }
    if (classic.archiveConfirmation !== "confirmed") {
      throw new Error(`Cannot apply ${event}: archiveConfirmation must be confirmed`);
    }
    setField(classic, effects, "archived", true);
  }
  return { classic, effects, definition };
}

// domains/comet-entry/current-selection.ts
init_race_safe_read();
import { randomUUID as randomUUID6 } from "crypto";
import { promises as fs14 } from "fs";
import path20 from "path";
var COMET_CURRENT_SELECTION_SCHEMA = "comet.selection.v2";
var COMET_CURRENT_SELECTION_MAX_BYTES = 16 * 1024;
function cometCurrentSelectionFile(projectRoot) {
  return path20.join(projectRoot, ".comet", "current-change.json");
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function validBranch(value) {
  return value === null || typeof value === "string";
}
function parseSelection(source) {
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(
      `current change selection contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  if (!isRecord(value)) {
    throw new Error("current change selection must be a JSON object");
  }
  if (value.version === 1) {
    if (typeof value.change !== "string") {
      throw new Error("legacy current change selection change must be a string");
    }
    if (value.branch !== void 0 && !validBranch(value.branch)) {
      throw new Error("legacy current change selection branch must be a string or null");
    }
    return {
      selection: {
        schema: COMET_CURRENT_SELECTION_SCHEMA,
        workflow: "classic",
        change: value.change,
        branch: value.branch ?? null
      },
      legacy: true
    };
  }
  if (value.schema !== COMET_CURRENT_SELECTION_SCHEMA) {
    throw new Error(`current change selection schema must be ${COMET_CURRENT_SELECTION_SCHEMA}`);
  }
  if (value.workflow !== "native" && value.workflow !== "classic") {
    throw new Error("current change selection workflow must be native or classic");
  }
  if (typeof value.change !== "string") {
    throw new Error("current change selection change must be a string");
  }
  if (!validBranch(value.branch)) {
    throw new Error("current change selection branch must be a string or null");
  }
  if (value.workflow === "native" && value.branch !== null) {
    throw new Error("Native current change selection branch must be null");
  }
  return { selection: value, legacy: false };
}
async function readCometCurrentSelection(projectRoot) {
  let source;
  try {
    const file = cometCurrentSelectionFile(projectRoot);
    const { bytes } = await readFileRaceSafe(file, COMET_CURRENT_SELECTION_MAX_BYTES, {
      label: "current change selection"
    });
    source = bytes.toString("utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { status: "missing" };
    throw new Error(
      `cannot read current change selection: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  const parsed = parseSelection(source);
  return { status: "selected", ...parsed };
}
async function writeCometCurrentSelection(projectRoot, selection) {
  const parsed = parseSelection(JSON.stringify(selection));
  if (parsed.legacy) throw new Error("cannot write a legacy current change selection");
  const file = cometCurrentSelectionFile(projectRoot);
  const temporary = `${file}.${randomUUID6()}.tmp`;
  await fs14.mkdir(path20.dirname(file), { recursive: true });
  try {
    await fs14.writeFile(temporary, `${JSON.stringify(parsed.selection, null, 2)}
`, "utf8");
    await fs14.rename(temporary, file);
  } catch (error) {
    await fs14.rm(temporary, { force: true });
    throw error;
  }
}
async function clearCometCurrentSelection(projectRoot) {
  await fs14.rm(cometCurrentSelectionFile(projectRoot), { force: true });
}
async function clearCometCurrentSelectionIf(projectRoot, workflow, change) {
  const current = await readCometCurrentSelection(projectRoot);
  if (current.status !== "selected" || current.selection.workflow !== workflow || current.selection.change !== change) {
    return false;
  }
  await clearCometCurrentSelection(projectRoot);
  return true;
}

// domains/comet-classic/classic-branch-binding.ts
var import_yaml5 = __toESM(require_dist(), 1);
import { execFileSync } from "child_process";
import { randomUUID as randomUUID7 } from "crypto";
import { promises as fs15 } from "fs";
import path21 from "path";
function liveGitBranch(cwd) {
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return branch && branch !== "HEAD" ? branch : null;
  } catch {
    return null;
  }
}
function isGitWorkTree(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim() === "true";
  } catch {
    return false;
  }
}
var BOUND_BRANCH_ISOLATIONS = ["current", "branch", "worktree"];
function requiresBranchBinding(isolation) {
  return BOUND_BRANCH_ISOLATIONS.includes(isolation);
}
function evaluateBranchBinding(input) {
  if (!requiresBranchBinding(input.isolation)) return { status: "not-applicable" };
  if (input.boundBranch === null && input.currentBranch === null && input.gitWorkTree === false) {
    return { status: "not-applicable" };
  }
  if (input.boundBranch === null) {
    return input.currentBranch === null ? { status: "unbound-detached" } : { status: "needs-heal", branch: input.currentBranch };
  }
  if (input.currentBranch === input.boundBranch) return { status: "ok" };
  return { status: "drift", boundBranch: input.boundBranch, currentBranch: input.currentBranch };
}
async function resolveBranchBinding(changeDir, options) {
  const file = path21.join(changeDir, ".comet.yaml");
  const document = (0, import_yaml5.parseDocument)(await fs15.readFile(file, "utf8"), { uniqueKeys: false });
  if (document.errors.length > 0) {
    throw new Error(`Invalid .comet.yaml: ${document.errors[0].message}`);
  }
  const record2 = document.toJS() ?? {};
  const isolation = typeof record2.isolation === "string" ? record2.isolation : null;
  const boundBranch = typeof record2.bound_branch === "string" && record2.bound_branch !== "" ? record2.bound_branch : null;
  const bindingRequired = requiresBranchBinding(isolation);
  const currentBranch = liveGitBranch(options.cwd);
  const gitWorkTree = bindingRequired && boundBranch === null && currentBranch === null ? isGitWorkTree(options.cwd) : true;
  const verdict = evaluateBranchBinding({ isolation, boundBranch, currentBranch, gitWorkTree });
  if (verdict.status === "needs-heal" && options.heal) {
    await healBoundBranch(changeDir, verdict.branch);
    return { status: "healed", branch: verdict.branch, bindingRequired, currentBranch };
  }
  return { ...verdict, bindingRequired, currentBranch };
}
async function healBoundBranch(changeDir, branch) {
  const file = path21.join(changeDir, ".comet.yaml");
  const document = (0, import_yaml5.parseDocument)(await fs15.readFile(file, "utf8"), { uniqueKeys: false });
  document.set("bound_branch", branch);
  const temporary = `${file}.${randomUUID7()}.tmp`;
  try {
    await fs15.writeFile(temporary, document.toString(), "utf8");
    await fs15.rename(temporary, file);
  } catch (error) {
    await fs15.rm(temporary, { force: true });
    throw error;
  }
}
function branchLabel(currentBranch) {
  return currentBranch ?? "detached HEAD";
}
function driftBlockedMessage(change, boundBranch, currentBranch) {
  return `change '${change}' is bound to branch '${boundBranch}', but current branch is '${branchLabel(currentBranch)}'.
Next: ask the user to confirm — switch back to '${boundBranch}', or run \`comet state rebind ${change}\` after explicit confirmation.`;
}
function driftStaleReason(change, boundBranch, currentBranch) {
  return `change '${change}' is bound to branch '${boundBranch}', but current branch is '${branchLabel(currentBranch)}'`;
}
function unboundDetachedMessage(change) {
  return `change '${change}' uses a branch-bound workspace mode but has no bound branch and HEAD is detached; checkout a branch first before continuing.`;
}

// domains/comet-classic/classic-current-change.ts
async function validateActiveChange(projectRoot, changeName) {
  assertOpenSpecChangeName(changeName);
  const active = await inspectClassicActiveChangeDirectory(changeName, projectRoot);
  if (!active.stateExists) {
    throw new Error(`Cannot select current change '${changeName}': active change state not found`);
  }
  const projection = await readClassicState(active.directory, { migrate: false });
  if (!projection.classic) {
    throw new Error(`Cannot select current change '${changeName}': Classic state is incomplete`);
  }
  if (projection.classic.archived) {
    throw new Error(`Cannot select current change '${changeName}': change is archived`);
  }
  return active.directory;
}
async function selectCurrentChange(projectRoot, changeName) {
  const changeDir = await validateActiveChange(projectRoot, changeName);
  const outcome = await resolveBranchBinding(changeDir, {
    heal: true,
    cwd: projectRoot
  });
  if (outcome.status === "drift") {
    throw new Error(driftStaleReason(changeName, outcome.boundBranch, outcome.currentBranch));
  }
  if (outcome.status === "unbound-detached") {
    throw new Error(unboundDetachedMessage(changeName));
  }
  const selection = {
    schema: "comet.selection.v2",
    workflow: "classic",
    change: changeName,
    branch: outcome.currentBranch
  };
  await writeCometCurrentSelection(projectRoot, selection);
  return selection;
}
async function resolveCurrentChange(projectRoot) {
  let current;
  try {
    current = await readCometCurrentSelection(projectRoot);
  } catch (error) {
    return {
      status: "stale",
      reason: error instanceof Error ? error.message : String(error)
    };
  }
  if (current.status === "missing") return { status: "missing" };
  if (current.selection.workflow !== "classic") {
    return {
      status: "stale",
      reason: `current change '${current.selection.change}' belongs to Native, not Classic`
    };
  }
  const selection = current.selection;
  let changeDir;
  try {
    changeDir = await validateActiveChange(projectRoot, selection.change);
  } catch (error) {
    return {
      status: "stale",
      reason: error instanceof Error ? error.message : String(error)
    };
  }
  const outcome = await resolveBranchBinding(changeDir, {
    heal: false,
    cwd: projectRoot
  });
  if (outcome.status === "drift") {
    return {
      status: "stale",
      reason: driftStaleReason(selection.change, outcome.boundBranch, outcome.currentBranch)
    };
  }
  if (outcome.status === "unbound-detached") {
    return { status: "stale", reason: unboundDetachedMessage(selection.change) };
  }
  if (outcome.status === "ok") return { status: "selected", selection };
  if (selection.branch !== null && outcome.currentBranch !== selection.branch) {
    return {
      status: "stale",
      reason: `current change '${selection.change}' was selected on branch '${selection.branch}', current branch is '${outcome.currentBranch ?? "detached HEAD"}'`
    };
  }
  return { status: "selected", selection };
}
async function clearCurrentChange(projectRoot) {
  let current;
  try {
    current = await readCometCurrentSelection(projectRoot);
  } catch {
    return;
  }
  if (current.status === "selected" && current.selection.workflow === "classic") {
    await clearCometCurrentSelection(projectRoot);
  }
}
async function clearCurrentChangeIf(projectRoot, change) {
  return clearCometCurrentSelectionIf(projectRoot, "classic", change);
}

// domains/comet-classic/classic-archive.ts
var GREEN = "\x1B[32m";
var RED = "\x1B[31m";
var YELLOW = "\x1B[33m";
var RESET = "\x1B[0m";
function green(message) {
  return `${GREEN}${message}${RESET}`;
}
function red(message) {
  return `${RED}${message}${RESET}`;
}
function yellow(message) {
  return `${YELLOW}${message}${RESET}`;
}
var ArchiveFailure = class extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
  exitCode;
};
var ArchiveOutput = class {
  stderr = [];
  openSpecStdout = [];
  openSpecStderr = [];
  stepsOk = 0;
  stepsTotal = 0;
  captureOpenSpec(result5) {
    if (result5.stdout) this.openSpecStdout.push(result5.stdout);
    if (result5.stderr) this.openSpecStderr.push(result5.stderr);
  }
  toResult(exitCode = 0) {
    const diagnostics = this.stderr.length > 0 ? this.stderr.join("\n") + "\n" : "";
    const openSpecStderr = this.openSpecStderr.join("");
    const separator = openSpecStderr && diagnostics && !openSpecStderr.endsWith("\n") ? "\n" : "";
    return {
      exitCode,
      ...this.openSpecStdout.length > 0 ? { stdout: this.openSpecStdout.join("") } : {},
      ...openSpecStderr || diagnostics ? { stderr: `${openSpecStderr}${separator}${diagnostics}` } : {}
    };
  }
};
function validateChangeName(name) {
  const error = openSpecChangeNameError(name);
  if (error) throw new ArchiveFailure(red(`FATAL: ${error}`));
}
function hashText(content) {
  return createHash6("sha256").update(content).digest("hex");
}
function artifactsHash(artifacts) {
  return hashText(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(artifacts).sort(([left], [right]) => left.localeCompare(right))
      )
    )
  );
}
function isPathInside(parent, target) {
  const relative = path22.relative(parent, target);
  return relative !== "" && !path22.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path22.sep}`);
}
function archivedPointer(projectRoot, activeDir, archiveDir, pointer) {
  if (!pointer) return pointer;
  const absolute = path22.resolve(projectRoot, pointer);
  if (!isPathInside(activeDir, absolute)) return pointer;
  return classicProjectRelative(
    projectRoot,
    path22.join(archiveDir, path22.relative(activeDir, absolute))
  );
}
function archivedArtifacts(projectRoot, activeDir, archiveDir, artifacts) {
  const rewritten = { ...artifacts };
  for (const field2 of ["handoff_context", "handoff_markdown"]) {
    const value = rewritten[field2];
    if (!value) continue;
    rewritten[field2] = archivedPointer(projectRoot, activeDir, archiveDir, value) ?? value;
  }
  return rewritten;
}
async function verifyFinalArchiveIntegrity(projectRoot, archiveDir) {
  const projection = await readClassicState(archiveDir);
  if (!projection.classic || !projection.run || !projection.classic.archived) {
    throw new ArchiveFailure(red("  [FAIL] Final archived state is incomplete"));
  }
  const statePointers = [
    ["design_doc", projection.classic.designDoc],
    ["plan", projection.classic.plan],
    ["verification_report", projection.classic.verificationReport],
    ["handoff_context", projection.classic.handoffContext]
  ];
  const artifacts = await readArtifacts(archiveDir, projection.run.artifactsRef);
  const artifactPointers = [
    ["artifacts.handoff_context", artifacts.handoff_context],
    ["artifacts.handoff_markdown", artifacts.handoff_markdown]
  ];
  for (const [field2, pointer] of [...statePointers, ...artifactPointers]) {
    if (!pointer) continue;
    if (!await classicProjectTargetExists(projectRoot, path22.resolve(projectRoot, pointer), {
      label: `Classic archived ${field2}`,
      expected: "file"
    })) {
      throw new ArchiveFailure(red(`  [FAIL] Final archived ${field2} does not exist: ${pointer}`));
    }
  }
}
function exactlyOneFinalNewline(markdown) {
  return `${markdown.replace(/\n+$/u, "")}
`;
}
function annotatedMarkdown(original, archiveName, extraFields) {
  const normalized2 = original.replace(/\r\n/gu, "\n");
  const lines = normalized2.split("\n");
  const closingDelimiter = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  const extraFieldName = extraFields.match(/^([^:\n]+):/u)?.[1]?.trim();
  if (closingDelimiter !== -1) {
    const frontmatter = lines.slice(1, closingDelimiter).filter((line) => {
      const fieldName = line.match(/^([^:\n]+):/u)?.[1]?.trim();
      if (fieldName === void 0) return true;
      return fieldName !== "archived-with" && fieldName !== extraFieldName;
    });
    frontmatter.push(`archived-with: ${archiveName}`);
    if (extraFields) frontmatter.push(extraFields);
    return exactlyOneFinalNewline(
      ["---", ...frontmatter, "---", ...lines.slice(closingDelimiter + 1)].join("\n")
    );
  }
  const header = ["---", `archived-with: ${archiveName}`];
  if (extraFields) header.push(extraFields);
  if (extraFieldName !== "status") header.push("status: final");
  header.push("---");
  return exactlyOneFinalNewline([...header, normalized2].join("\n"));
}
async function appendRecoveryEvent(changeDir, run, actionId) {
  const trajectory = await readTrajectory(changeDir, run.trajectoryRef);
  if (trajectory.some(
    (event) => event.type === "recovery_reconciled" && event.data.kind === "classic-archive" && event.data.actionId === actionId
  )) {
    return;
  }
  await appendTrajectory(changeDir, run.trajectoryRef, {
    sequence: trajectory.length + 1,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    type: "recovery_reconciled",
    runId: run.runId,
    data: {
      kind: "classic-archive",
      actionId
    }
  });
}
async function annotateFrontmatter(output, projectRoot, file, archiveName, extraFields, dryRun) {
  if (!await classicProjectTargetExists(projectRoot, file, {
    label: "Classic archive annotation target",
    expected: "file"
  })) {
    return;
  }
  if (dryRun) {
    output.stderr.push(yellow(`  [DRY-RUN] Would annotate: ${file}`));
    output.stepsOk += 1;
    output.stepsTotal += 1;
    return;
  }
  const original = await readClassicProjectFile(projectRoot, file, {
    label: "Classic archive annotation target"
  });
  const updated = annotatedMarkdown(original, archiveName, extraFields);
  await writeClassicProjectText(projectRoot, file, updated, {
    label: "Classic archive annotation target"
  });
  output.stderr.push(green(`  [OK] Annotated: ${file}`));
  output.stepsOk += 1;
  output.stepsTotal += 1;
}
async function verifyMainSpecsClean(projectRoot, specsRoot) {
  const rootInspection = await inspectClassicProjectTarget(projectRoot, specsRoot, {
    label: "Classic main specs directory",
    expected: "directory"
  });
  if (!rootInspection.exists) return;
  let found = false;
  const entries = await fs16.readdir(specsRoot, { withFileTypes: true });
  for (const entry2 of entries) {
    if (!entry2.isDirectory() && !entry2.isSymbolicLink()) continue;
    const specFile = `${specsRoot}/${entry2.name}/spec.md`;
    const content = await (async () => {
      if (!await classicProjectTargetExists(projectRoot, specFile, {
        label: `Classic main spec ${entry2.name}`,
        expected: "file"
      })) {
        return null;
      }
      return readClassicProjectFile(projectRoot, specFile, {
        label: `Classic main spec ${entry2.name}`
      });
    })();
    if (content === null) continue;
    const matches = content.split(/\r?\n/u).map((line, index) => ({ line, number: index + 1 })).filter((item) => /^## (ADDED|MODIFIED|REMOVED|RENAMED) Requirements$/u.test(item.line));
    if (matches.length > 0) {
      found = true;
      process.stderr.write(
        red(`FATAL: delta-only section heading leaked into main spec: ${specFile}`) + "\n"
      );
      for (const match of matches) process.stderr.write(`${match.number}:${match.line}
`);
    }
  }
  if (found) throw new ArchiveFailure("");
}
var classicArchiveCommand = async (args) => {
  const output = new ArchiveOutput();
  const change = args[0];
  const dryRun = args[1] === "--dry-run";
  try {
    validateChangeName(change);
    const projectRoot = await discoverClassicProject(process.cwd());
    const layout = await assertClassicLayoutWritable(projectRoot);
    const active = await inspectClassicActiveChangeDirectory(change, layout.projectRoot);
    const activeDir = active.directory;
    const activeRef = classicProjectRelative(layout.projectRoot, activeDir);
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    let archiveName = `${today}-${change}`;
    let archiveDir = path22.join(layout.archiveDir, archiveName);
    output.stderr.push(`=== Comet Archive: ${change} ===`);
    const activeExists = active.stateExists;
    const recoveredArchive = activeExists ? null : await findClassicArchiveChangeDirectory(change, layout.projectRoot);
    const changeDir = activeExists ? activeDir : recoveredArchive?.directory;
    if (!changeDir || !await classicProjectTargetExists(layout.projectRoot, `${changeDir}/.comet.yaml`, {
      label: `Classic change ${change} state`,
      expected: "file"
    })) {
      throw new ArchiveFailure(red(`FATAL: .comet.yaml not found in ${activeRef}/`));
    }
    if (recoveredArchive) {
      archiveDir = recoveredArchive.directory;
      archiveName = path22.basename(recoveredArchive.directory);
    }
    const projection = await readClassicState(changeDir);
    if (!projection.classic) {
      throw new ArchiveFailure(red("FATAL: archive requires Classic state"));
    }
    const classic = projection.classic;
    const designDoc = classic.designDoc;
    const planPath = classic.plan;
    if (classic.phase !== "archive") {
      throw new ArchiveFailure(red(`FATAL: phase is '${classic.phase}', expected 'archive'`));
    }
    if (classic.verifyResult !== "pass") {
      throw new ArchiveFailure(
        red(
          `FATAL: verify_result is '${classic.verifyResult}', expected 'pass'. Run comet-verify first.`
        )
      );
    }
    output.stderr.push(green("  [OK] Entry state verified"));
    output.stepsOk += 1;
    output.stepsTotal += 1;
    const archiveTarget = await inspectClassicProjectTarget(layout.projectRoot, archiveDir, {
      label: `Classic archive target ${archiveName}`,
      expected: "directory"
    });
    if (activeExists && archiveTarget.exists) {
      throw new ArchiveFailure(red(`FATAL: archive target already exists: ${archiveDir}`));
    }
    output.stderr.push(green("  [OK] Archive target available"));
    output.stepsOk += 1;
    output.stepsTotal += 1;
    if (dryRun) {
      output.stderr.push(yellow(`  [DRY-RUN] Would run OpenSpec archive: ${change}`));
      output.stepsOk += 1;
      output.stepsTotal += 1;
    } else if (!classic.archived || projection.run?.pending) {
      await ensureClassicProjectDirectory(
        layout.projectRoot,
        `${changeDir}/.comet`,
        "Classic change runtime directory"
      );
      const runtime = await ensureClassicRuntimeRun(changeDir);
      const actionId = `classic-archive:${change}`;
      const pendingAction = await readPendingAction(changeDir, runtime.run.pendingRef);
      const recovering = Boolean(recoveredArchive) || pendingAction?.id === actionId && pendingAction.type === "checkpoint" && pendingAction.ref === change;
      if (runtime.run.pending && runtime.run.pending !== actionId) {
        throw new ArchiveFailure(red(`FATAL: another action is pending: ${runtime.run.pending}`));
      }
      if (!recovering && !classic.archived && classic.archiveConfirmation !== "confirmed") {
        throw new ArchiveFailure(
          red(
            `FATAL: archive_confirmation is '${classic.archiveConfirmation ?? "null"}', expected 'confirmed'. Run final archive confirmation first.`
          )
        );
      }
      if (!recovering) {
        const action = {
          id: actionId,
          stepId: runtime.run.currentStep,
          type: "checkpoint",
          ref: change
        };
        await writePendingAction(changeDir, runtime.run.pendingRef, action);
        await writeClassicState(changeDir, {
          classic: runtime.classic,
          run: {
            ...runtime.run,
            pending: actionId,
            status: "waiting"
          },
          unknownKeys: (await readClassicState(changeDir)).unknownKeys
        });
      }
      if (!recoveredArchive) {
        const archiveRun = await executeClassicOpenSpec(
          ["archive", change, "--yes"],
          layout.projectRoot
        );
        output.captureOpenSpec(archiveRun);
        if (archiveRun.exitCode !== 0) {
          throw new ArchiveFailure("", archiveRun.exitCode);
        }
      }
      let resolvedArchive = await findClassicArchiveChangeDirectory(change, layout.projectRoot, {
        preferredArchiveName: archiveName
      });
      if (!resolvedArchive && !recoveredArchive) {
        resolvedArchive = await findClassicArchiveChangeDirectory(change, layout.projectRoot, {
          skipExactCompatibility: true
        });
      }
      if (!resolvedArchive) {
        output.stderr.push(red("  [FAIL] OpenSpec archive output not found"));
        output.stepsTotal += 1;
        output.stderr.push("");
        output.stderr.push(
          green(`Archive complete. ${output.stepsOk}/${output.stepsTotal} steps succeeded.`)
        );
        return output.toResult(1);
      }
      archiveDir = resolvedArchive.directory;
      archiveName = path22.basename(resolvedArchive.directory);
      output.stderr.push(green(`  [OK] OpenSpec archive completed: ${archiveDir}`));
      output.stepsOk += 1;
      output.stepsTotal += 1;
      await verifyMainSpecsClean(layout.projectRoot, layout.specsDir);
      output.stderr.push(green("  [OK] Main specs verified clean"));
      output.stepsOk += 1;
      output.stepsTotal += 1;
      if (designDoc) {
        await annotateFrontmatter(
          output,
          layout.projectRoot,
          designDoc,
          archiveName,
          "status: final",
          false
        );
      }
      if (planPath) {
        await annotateFrontmatter(output, layout.projectRoot, planPath, archiveName, "", false);
      }
      const archivedProjection = await readClassicState(archiveDir);
      if (!archivedProjection.classic || !archivedProjection.run) {
        throw new ArchiveFailure(red("  [FAIL] archived state projection is incomplete"));
      }
      const artifacts = {
        ...archivedArtifacts(
          layout.projectRoot,
          activeDir,
          archiveDir,
          await readArtifacts(archiveDir, archivedProjection.run.artifactsRef)
        ),
        archive_directory: classicProjectRelative(layout.projectRoot, archiveDir)
      };
      await writeArtifacts(archiveDir, archivedProjection.run.artifactsRef, artifacts);
      const archiveTransition = applyClassicTransition(
        recovering && archivedProjection.classic.archiveConfirmation !== "confirmed" ? { ...archivedProjection.classic, archiveConfirmation: "confirmed" } : archivedProjection.classic,
        "archived"
      );
      const archivedClassic = {
        ...archiveTransition.classic,
        designDoc: archivedPointer(
          layout.projectRoot,
          activeDir,
          archiveDir,
          archiveTransition.classic.designDoc
        ),
        plan: archivedPointer(
          layout.projectRoot,
          activeDir,
          archiveDir,
          archiveTransition.classic.plan
        ),
        verificationReport: archivedPointer(
          layout.projectRoot,
          activeDir,
          archiveDir,
          archiveTransition.classic.verificationReport
        ),
        handoffContext: archivedPointer(
          layout.projectRoot,
          activeDir,
          archiveDir,
          archiveTransition.classic.handoffContext
        )
      };
      let transitionedRun = archivedProjection.run;
      if (archivedProjection.run.currentStep !== "completed" || archivedProjection.run.status !== "completed") {
        transitionedRun = await transitionClassicRuntimeRun(
          archiveDir,
          archivedClassic,
          archivedProjection.run,
          {
            actionId,
            archiveDirectory: classicProjectRelative(layout.projectRoot, archiveDir),
            event: "archived",
            source: "comet-archive"
          }
        );
      }
      if (recovering) {
        await appendRecoveryEvent(archiveDir, transitionedRun, actionId);
      }
      const trajectory = await readTrajectory(archiveDir, transitionedRun.trajectoryRef);
      const context = await readContext(archiveDir, transitionedRun.contextRef);
      const checkpoint = {
        runId: transitionedRun.runId,
        stateVersion: transitionedRun.iteration,
        trajectoryOffset: trajectory.length,
        contextHash: context === null ? null : hashText(context),
        artifactsHash: artifactsHash(artifacts),
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      await writeCheckpoint(archiveDir, transitionedRun.checkpointRef, checkpoint);
      const completedRun = {
        ...transitionedRun,
        pending: null,
        status: "completed"
      };
      await writeClassicState(archiveDir, {
        classic: archivedClassic,
        run: completedRun,
        unknownKeys: archivedProjection.unknownKeys
      });
      await appendClassicStateEvent(archiveDir, {
        change: archiveName,
        event: "archived",
        source: "comet-archive",
        from: archivedProjection.classic,
        to: archivedClassic,
        effects: archiveTransition.effects
      });
      await clearPendingAction(archiveDir, completedRun.pendingRef);
      output.stderr.push(green("  [OK] archived: true"));
      output.stepsOk += 1;
      output.stepsTotal += 1;
    } else {
      if (!projection.run) {
        throw new ArchiveFailure(
          red("FATAL: archived Classic state is missing its Run projection")
        );
      }
      output.stderr.push(green(`  [OK] OpenSpec archive completed: ${archiveDir}`));
      output.stepsOk += 1;
      output.stepsTotal += 1;
      output.stderr.push(green("  [OK] Main specs verified clean"));
      output.stepsOk += 1;
      output.stepsTotal += 1;
      output.stderr.push(green("  [OK] archived: true"));
      output.stepsOk += 1;
      output.stepsTotal += 1;
    }
    if (dryRun) {
      if (designDoc) {
        await annotateFrontmatter(
          output,
          layout.projectRoot,
          designDoc,
          archiveName,
          "status: final",
          true
        );
      }
      if (planPath) {
        await annotateFrontmatter(output, layout.projectRoot, planPath, archiveName, "", true);
      }
      output.stderr.push(
        yellow(`  [DRY-RUN] Would set archived: true in ${archiveDir}/.comet.yaml`)
      );
      output.stepsOk += 1;
      output.stepsTotal += 1;
      output.stderr.push(yellow("  [DRY-RUN] Would verify final archive integrity"));
      output.stepsOk += 1;
      output.stepsTotal += 1;
    } else {
      await verifyFinalArchiveIntegrity(layout.projectRoot, archiveDir);
      output.stderr.push(green("  [OK] Final archive integrity verified"));
      output.stepsOk += 1;
      output.stepsTotal += 1;
    }
    if (!dryRun) await clearCurrentChangeIf(layout.projectRoot, change);
    output.stderr.push("");
    output.stderr.push(
      dryRun ? yellow(`Dry run complete. ${output.stepsOk}/${output.stepsTotal} steps would succeed.`) : green(`Archive complete. ${output.stepsOk}/${output.stepsTotal} steps succeeded.`)
    );
    return output.toResult(output.stepsOk < output.stepsTotal ? 1 : 0);
  } catch (error) {
    if (error instanceof ArchiveFailure) {
      if (error.message) {
        for (const line of error.message.split("\n")) output.stderr.push(line);
      }
      return output.toResult(error.exitCode);
    }
    throw error;
  }
};

// domains/comet-classic/classic-guard.ts
var import_yaml7 = __toESM(require_dist(), 1);
import { spawnSync as spawnSync2 } from "child_process";
import { createHash as createHash7 } from "crypto";
import { promises as fs18 } from "fs";
import path27 from "path";

// domains/comet-classic/classic-command-checks.ts
import path23 from "path";
function validateScope(scope) {
  if (scope !== "build" && scope !== "verify") {
    throw new Error(`Invalid command check scope: '${String(scope)}'`);
  }
}
function normalizedCwd(projectRoot, cwd = ".") {
  if (cwd.trim().length === 0) throw new Error("Command check cwd cannot be blank");
  const root = path23.resolve(projectRoot);
  const target = path23.resolve(root, cwd);
  if (target !== root && !target.startsWith(root + path23.sep)) {
    throw new Error(`Command check cwd must resolve within the project root: '${cwd}'`);
  }
  return path23.relative(root, target).replaceAll("\\", "/") || ".";
}
function validRecord(projectRoot, event) {
  if (event.type !== "command_check_recorded") return null;
  const data = event.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const { scope, command, exitCode, cwd } = data;
  if (scope !== "build" && scope !== "verify" || typeof command !== "string" || command.trim().length === 0 || !Number.isInteger(exitCode) || typeof cwd !== "string") {
    return null;
  }
  let normalized2;
  try {
    normalized2 = normalizedCwd(projectRoot, cwd);
  } catch {
    return null;
  }
  return {
    sequence: event.sequence,
    timestamp: event.timestamp,
    runId: event.runId,
    scope,
    command,
    exitCode,
    cwd: normalized2
  };
}
async function recordCommandCheck(projectRoot, changeDir, run, input) {
  validateScope(input.scope);
  if (typeof input.command !== "string" || input.command.trim().length === 0) {
    throw new Error("Command check command cannot be blank");
  }
  if (!Number.isInteger(input.exitCode)) {
    throw new Error("Command check exitCode must be an integer");
  }
  const trajectory = await readTrajectory(changeDir, run.trajectoryRef);
  const recorded = {
    sequence: trajectory.reduce((maximum, event) => Math.max(maximum, event.sequence), 0) + 1,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    runId: run.runId,
    scope: input.scope,
    command: input.command,
    exitCode: input.exitCode,
    cwd: normalizedCwd(projectRoot, input.cwd)
  };
  await appendTrajectory(changeDir, run.trajectoryRef, {
    sequence: recorded.sequence,
    timestamp: recorded.timestamp,
    type: "command_check_recorded",
    runId: recorded.runId,
    data: {
      scope: recorded.scope,
      command: recorded.command,
      exitCode: recorded.exitCode,
      cwd: recorded.cwd
    }
  });
  return recorded;
}
async function latestCommandCheck(projectRoot, changeDir, run, scope) {
  validateScope(scope);
  const trajectory = await readTrajectory(changeDir, run.trajectoryRef);
  for (let index = trajectory.length - 1; index >= 0; index -= 1) {
    const event = trajectory[index];
    if (event.runId !== run.runId) continue;
    const record2 = validRecord(projectRoot, event);
    if (record2?.scope === scope) return record2;
  }
  return null;
}

// domains/comet-classic/classic-runtime-evals.ts
var STEP_EVIDENCE = {
  "full.open": ["openspec.proposal", "openspec.tasks"],
  "full.design.handoff": ["openspec.proposal", "openspec.design", "openspec.tasks"],
  "full.design.document": ["design.handoff"],
  "full.build.plan": ["openspec.tasks"],
  "full.build.plan-ready": ["build.plan"],
  "full.build.configure": ["build.plan"],
  "full.build.execute": ["build.plan"],
  "full.build.complete": ["build.tasks-complete"],
  "full.verify.run": ["build.tasks-complete"],
  "full.verify.branch": ["verification.report"],
  "full.archive.confirm": ["verification.report"],
  "full.archive.execute": ["archive.confirmed"]
};
function requirementsFor(stepId) {
  if (STEP_EVIDENCE[stepId]) return STEP_EVIDENCE[stepId];
  if (stepId.endsWith(".open")) return ["openspec.proposal", "openspec.tasks"];
  if (stepId.endsWith(".build.execute")) return [];
  if (stepId.endsWith(".build.complete")) return ["build.tasks-complete"];
  if (stepId.endsWith(".verify.run")) return ["build.tasks-complete"];
  if (stepId.endsWith(".verify.branch")) return ["verification.report"];
  if (stepId.endsWith(".archive.confirm")) return ["verification.report"];
  if (stepId.endsWith(".archive.execute")) return ["archive.confirmed"];
  return [];
}
function evaluateClassicRuntimeStep(stepId, evidence) {
  const requiredEvidence = requirementsFor(stepId);
  const missingEvidence = requiredEvidence.filter((code) => !evidenceSatisfied(evidence, code));
  return {
    stepId,
    passed: missingEvidence.length === 0,
    requiredEvidence,
    missingEvidence
  };
}

// domains/comet-classic/classic-diagnostics.ts
function nextCommandForPhase(phase) {
  switch (phase) {
    case "open":
      return "/comet-open";
    case "design":
      return "/comet-design";
    case "build":
      return "/comet-build";
    case "verify":
      return "/comet-verify";
    case "archive":
      return "/comet-archive";
    default:
      return null;
  }
}
async function inspectClassicChange(changeDir, name) {
  try {
    const runtime = await ensureStrictClassicRuntimeRun(changeDir);
    const evidence = await collectClassicEvidence(changeDir, {
      classic: runtime.classic,
      run: runtime.run,
      unknownKeys: []
    });
    const currentStep = resolveClassicStepId(runtime.classic, evidence);
    return {
      name,
      valid: true,
      workflow: runtime.classic.workflow,
      phase: runtime.classic.phase,
      currentStep,
      nextCommand: nextCommandForPhase(runtime.classic.phase),
      runtimeMode: "engine-projection",
      runtimeEval: evaluateClassicRuntimeStep(currentStep, evidence),
      evidence
    };
  } catch (error) {
    return {
      name,
      valid: false,
      workflow: "unknown",
      phase: "invalid",
      currentStep: null,
      nextCommand: null,
      runtimeMode: "invalid",
      runtimeEval: null,
      evidence: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// domains/comet-classic/classic-validate-command.ts
var import_yaml6 = __toESM(require_dist(), 1);
import path25 from "path";

// domains/comet-classic/classic-command-context.ts
import { AsyncLocalStorage } from "async_hooks";
import { promises as fs17 } from "fs";
import path24 from "path";
var commandContext = new AsyncLocalStorage();
function isInside3(parent, target) {
  const relative = path24.relative(parent, target);
  return relative === "" || !path24.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path24.sep}`);
}
async function resolveCommandContext(options) {
  const invocationCwd = path24.resolve(options.invocationCwd ?? process.cwd());
  const projectRoot = path24.resolve(
    options.projectRoot ?? await discoverClassicProject(invocationCwd)
  );
  const [realInvocationCwd, realProjectRoot] = await Promise.all([
    fs17.realpath(invocationCwd),
    fs17.realpath(projectRoot)
  ]);
  if (!isInside3(realProjectRoot, realInvocationCwd)) {
    throw new Error(
      `Classic command invocation cwd is outside the discovered project: ${invocationCwd}`
    );
  }
  return { invocationCwd, projectRoot };
}
async function withClassicCommandContext(options, operation) {
  const active = commandContext.getStore();
  if (active) return operation(active);
  const resolved = await resolveCommandContext(options);
  return commandContext.run(resolved, () => operation(resolved));
}
function classicCommandProjectRoot() {
  const active = commandContext.getStore();
  if (!active) throw new Error("Classic command project context is unavailable");
  return active.projectRoot;
}
function classicCommandInvocationCwd() {
  const active = commandContext.getStore();
  if (!active) throw new Error("Classic command invocation context is unavailable");
  return active.invocationCwd;
}

// domains/comet-classic/classic-validate-command.ts
var GREEN2 = "\x1B[32m";
var RED2 = "\x1B[31m";
var YELLOW2 = "\x1B[33m";
var RESET2 = "\x1B[0m";
var REQUIRED = [
  "workflow",
  "phase",
  "design_doc",
  "plan",
  "build_mode",
  "isolation",
  "verify_mode",
  "verify_result",
  "verified_at",
  "archived"
];
var ENUMS = {
  workflow: ["full", "hotfix", "tweak"],
  language: ["en", "zh-CN"],
  phase: ["open", "design", "build", "verify", "archive"],
  context_compression: ["off", "beta"],
  build_mode: ["subagent-driven-development", "executing-plans", "direct"],
  build_pause: ["plan-ready"],
  subagent_dispatch: ["confirmed"],
  tdd_mode: ["tdd", "direct"],
  review_mode: ["off", "standard", "thorough"],
  isolation: ["current", "branch", "worktree"],
  verify_mode: ["light", "full"],
  auto_transition: ["true", "false"],
  verify_result: ["pending", "pass", "fail"],
  branch_status: ["pending", "handled"],
  archive_confirmation: ["pending", "confirmed"],
  archived: ["true", "false"],
  direct_override: ["true", "false"],
  classic_profile: ["full", "hotfix", "tweak"],
  classic_migration: ["1"]
};
var KNOWN_KEYS2 = /* @__PURE__ */ new Set([
  ...CLASSIC_WIRE_KEYS,
  ...RUN_WIRE_KEYS,
  // just 'run_id'
  "classic_profile",
  "classic_migration"
]);
function color(code, message) {
  return `${code}${message}${RESET2}`;
}
function text(value) {
  if (value === null || value === void 0) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
var classicValidateCommand = async (args, options) => withClassicCommandContext(options, async () => {
  const name = args[0];
  const nameError = openSpecChangeNameError(name);
  if (nameError) {
    return {
      exitCode: 1,
      stderr: color(RED2, `ERROR: ${nameError}`)
    };
  }
  const projectRoot = classicCommandProjectRoot();
  const { directory, label } = await resolveClassicChangeDirectory(name, projectRoot);
  const yamlFile = path25.join(directory, ".comet.yaml");
  const lines = [`[VALIDATE] ${label}/.comet.yaml`];
  let errors = 0;
  let warnings = 0;
  const fail3 = (message) => {
    errors += 1;
    lines.push(color(RED2, `  FAIL: ${message}`));
  };
  const warn = (message) => {
    warnings += 1;
    lines.push(color(YELLOW2, `  WARN: ${message}`));
  };
  let source;
  try {
    source = await readClassicProjectFile(projectRoot, yamlFile, {
      label: `Classic state ${label}/.comet.yaml`
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      fail3(".comet.yaml does not exist");
      lines.push(
        "",
        color(RED2, `${errors} error(s), ${warnings} warning(s) — validation FAILED`)
      );
      return { exitCode: 1, stderr: lines.join("\n") };
    }
    throw error;
  }
  const document = (0, import_yaml6.parseDocument)(source);
  if (document.errors.length > 0 || !(0, import_yaml6.isMap)(document.contents)) {
    for (const error of document.errors) fail3(error.message);
    if (!(0, import_yaml6.isMap)(document.contents)) fail3("document root must be a mapping");
    lines.push("", color(RED2, `${errors} error(s), ${warnings} warning(s) — validation FAILED`));
    return { exitCode: 1, stderr: lines.join("\n") };
  }
  const record2 = document.toJS();
  for (const field2 of REQUIRED) {
    if (!Object.prototype.hasOwnProperty.call(record2, field2)) {
      fail3(`missing required field '${field2}'`);
    }
  }
  for (const [field2, values] of Object.entries(ENUMS)) {
    if (!Object.prototype.hasOwnProperty.call(record2, field2)) continue;
    const value = text(record2[field2]);
    if (!value) {
      if (field2 === "auto_transition") {
        fail3(`${field2}='' is not valid. Expected: ${values.join(" ")}`);
      }
      continue;
    }
    if (!values.includes(value)) {
      fail3(`${field2}='${value}' is not valid. Expected: ${values.join(" ")}`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(record2, "bound_branch")) {
    const value = record2.bound_branch;
    if (value !== null && typeof value !== "string") {
      fail3(`bound_branch='${text(value)}' is not a string or null`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(record2, "verify_failures")) {
    const value = record2.verify_failures;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      fail3(`verify_failures='${text(value)}' is not a non-negative integer`);
    }
  }
  for (const field2 of ["design_doc", "plan", "handoff_context", "verification_report"]) {
    const value = text(record2[field2]);
    if (!value) continue;
    if (/^(?:[A-Za-z]:|[\\/]|~)/u.test(value) || value.split(/[\\/]/u).includes("..")) {
      fail3(`${field2}='${value}' must be a relative repository path`);
      continue;
    }
    try {
      if (!await classicProjectTargetExists(projectRoot, path25.resolve(projectRoot, value), {
        label: `${field2} artifact pointer`,
        expected: "file"
      })) {
        fail3(`${field2}='${value}' does not exist on disk`);
      }
    } catch (error) {
      fail3(
        `${field2}='${value}' is unsafe: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  for (const field2 of ["handoff_hash"]) {
    const value = text(record2[field2]);
    if (value && !/^[a-f0-9]{64}$/u.test(value)) {
      fail3(`${field2}='${value}' is not a sha256 hex digest`);
    }
  }
  for (const field2 of Object.keys(record2)) {
    if (!KNOWN_KEYS2.has(field2)) warn(`unknown field '${field2}' found`);
  }
  lines.push("");
  if (errors > 0) {
    lines.push(color(RED2, `${errors} error(s), ${warnings} warning(s) — validation FAILED`));
    return { exitCode: 1, stderr: lines.join("\n") };
  }
  lines.push(color(GREEN2, `0 errors, ${warnings} warning(s) — validation PASSED`));
  return { exitCode: 0, stderr: lines.join("\n") };
});

// domains/comet-classic/classic-project-config.ts
init_project_config_reader();
import os from "os";
import path26 from "path";
function configCandidates(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const candidates = [
    { file: path26.resolve(cwd, ".comet", "config.yaml"), source: ".comet/config.yaml" },
    {
      file: path26.resolve(homeDir, ".comet", "config.yaml"),
      source: "~/.comet/config.yaml"
    }
  ];
  return candidates.filter(
    (candidate, index) => candidates.findIndex((entry2) => entry2.file === candidate.file) === index
  );
}
async function readClassicConfigValue(field2, options = {}) {
  for (const candidate of configCandidates(options)) {
    const document = await readWorkflowProjectConfigDocument(
      path26.dirname(path26.dirname(candidate.file)),
      {
        allowPartialProject: true
      }
    );
    if (!document) continue;
    const classic = document.value.classic;
    if (!classic || typeof classic !== "object" || Array.isArray(classic)) continue;
    const value = classic[field2];
    if (value === null || value === void 0) continue;
    return { value: String(value), source: candidate.source };
  }
  return null;
}

// domains/comet-classic/classic-guard.ts
init_project_config_reader();
var GREEN3 = "\x1B[32m";
var RED3 = "\x1B[31m";
var YELLOW3 = "\x1B[33m";
var RESET3 = "\x1B[0m";
var PHASES2 = ["open", "design", "build", "verify", "archive"];
var PHASE_HEADER = {
  open: "=== Guard: open → next ===",
  design: "=== Guard: design → build ===",
  build: "=== Guard: build → verify ===",
  verify: "=== Guard: verify → archive ===",
  archive: "=== Guard: archive completeness ==="
};
var APPLY_MESSAGE = {
  open: "  [APPLY] .comet.yaml updated: phase=PLACEHOLDER",
  design: "  [APPLY] .comet.yaml updated: phase=build",
  build: "  [APPLY] .comet.yaml updated: phase=verify, verify_result=pending",
  verify: "  [APPLY] .comet.yaml updated: phase=archive, verify_result=pass"
};
var CLASSIC_FIELD_WIRE_NAMES = {
  branchStatus: "branch_status",
  phase: "phase",
  verificationReport: "verification_report",
  verifiedAt: "verified_at",
  verifyResult: "verify_result"
};
function green2(message) {
  return `${GREEN3}${message}${RESET3}`;
}
function red2(message) {
  return `${RED3}${message}${RESET3}`;
}
function yellow2(message) {
  return `${YELLOW3}${message}${RESET3}`;
}
function wireField(field2) {
  return CLASSIC_FIELD_WIRE_NAMES[field2] ?? String(field2);
}
function wireValue(value) {
  if (value === null) return "null";
  if (value === void 0) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
var GuardFailure = class extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
  exitCode;
};
var GuardOutput = class {
  stderr = [];
  diagnostics;
  toResult(exitCode = 0) {
    return {
      exitCode,
      ...this.diagnostics ? { stdout: JSON.stringify({ diagnostics: this.diagnostics }) + "\n" } : {},
      ...this.stderr.length > 0 ? { stderr: this.stderr.join("\n") + "\n" } : {}
    };
  }
};
async function exists(file) {
  const projectRoot = classicCommandProjectRoot();
  return classicProjectTargetExists(projectRoot, file, {
    label: `Classic guard path ${path27.relative(projectRoot, path27.resolve(projectRoot, file)).replaceAll("\\", "/")}`
  });
}
async function nonempty(file) {
  const projectRoot = classicCommandProjectRoot();
  return classicProjectFileNonempty(
    projectRoot,
    file,
    `Classic guard file ${path27.relative(projectRoot, path27.resolve(projectRoot, file)).replaceAll("\\", "/")}`
  );
}
function validateChangeName2(name) {
  const error = openSpecChangeNameError(name);
  if (error) throw new GuardFailure(red2(`ERROR: ${error}`));
}
async function resolveChangeDir(name) {
  return (await resolveClassicChangeDirectory(name, classicCommandProjectRoot())).directory;
}
async function readField(changeDir, field2) {
  const file = path27.join(changeDir, ".comet.yaml");
  const document = (0, import_yaml7.parseDocument)(
    await readClassicProjectFile(classicCommandProjectRoot(), file, {
      label: `Classic state ${changeDir}/.comet.yaml`
    }),
    { uniqueKeys: false }
  );
  if (document.errors.length > 0) {
    throw new GuardFailure(`ERROR: Invalid .comet.yaml: ${document.errors[0].message}`);
  }
  const record2 = document.toJS();
  const value = record2[field2];
  if (value === null || value === void 0) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
async function projectConfigValue(field2, changeDir) {
  const changeValue = await readField(changeDir, field2);
  if (changeValue && changeValue !== "null") return changeValue;
  return (await readClassicConfigValue(field2, { cwd: classicCommandProjectRoot() }))?.value ?? "";
}
async function configuredLanguage(changeDir) {
  const language = await projectConfigValue("language", changeDir);
  if (!language) return "en";
  if (language === "en" || language === "zh-CN") return language;
  throw new Error(`configured language '${language}' is invalid; expected en or zh-CN.`);
}
function stripFencedCodeBlocks(source) {
  const kept = [];
  let inFence = false;
  for (const line of source.split(/\r?\n/u)) {
    if (/^\s*```/u.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) kept.push(line);
  }
  return kept.join("\n");
}
function countCjkChars(source) {
  return source.match(/[\u4e00-\u9fff]/gu)?.length ?? 0;
}
function countEnglishWords(source) {
  return source.match(/[A-Za-z][A-Za-z0-9_-]{2,}/gu)?.length ?? 0;
}
async function documentLanguageMatchesConfigured(changeDir, file) {
  const language = await configuredLanguage(changeDir);
  const source = stripFencedCodeBlocks(
    await readClassicProjectFile(classicCommandProjectRoot(), file, {
      label: `Classic language-check artifact ${file}`
    })
  );
  const cjk = countCjkChars(source);
  const englishWords = countEnglishWords(source);
  if (language === "zh-CN" && cjk < 20 && englishWords >= 20) {
    return fail(
      `configured language is zh-CN, but ${file} appears to be English-dominant (cjk_chars=${cjk}, english_words=${englishWords}).
Next: regenerate or rewrite this artifact in Chinese while preserving necessary technical terms.`
    );
  }
  if (language === "en" && cjk > 20 && cjk > englishWords) {
    return fail(
      `configured language is en, but ${file} appears to be Chinese-dominant (cjk_chars=${cjk}, english_words=${englishWords}).
Next: regenerate or rewrite this artifact in English while preserving necessary technical terms.`
    );
  }
  return pass();
}
async function hashFile(file) {
  return createHash7("sha256").update(
    await readClassicProjectBytes(classicCommandProjectRoot(), file, {
      label: `Classic handoff source ${file}`
    })
  ).digest("hex");
}
async function handoffSourceFiles(changeDir) {
  const changeRef = classicProjectRelative(classicCommandProjectRoot(), changeDir);
  const files = [`${changeRef}/proposal.md`, `${changeRef}/design.md`, `${changeRef}/tasks.md`];
  const specs = `${changeRef}/specs`;
  if (await exists(specs)) {
    await inspectClassicProjectTarget(classicCommandProjectRoot(), specs, {
      label: `Classic delta-spec directory ${specs}`,
      expected: "directory"
    });
    for (const entry2 of (await fs18.readdir(specs)).sort()) {
      const spec = `${specs}/${entry2}/spec.md`;
      if (await exists(spec)) files.push(spec);
    }
  }
  return files;
}
async function computeHandoffHash(changeDir) {
  const lines = [];
  for (const file of await handoffSourceFiles(changeDir)) {
    if (await exists(file)) {
      lines.push(`path:${file}`, `sha256:${await hashFile(file)}`);
    }
  }
  return createHash7("sha256").update(lines.join("\n")).digest("hex");
}
async function preflight(changeDir, name) {
  if (!await exists(changeDir)) {
    throw new GuardFailure(red2(`FATAL: change directory not found: ${changeDir}`));
  }
  if (!await exists(path27.join(changeDir, ".comet.yaml"))) {
    throw new GuardFailure(red2(`FATAL: .comet.yaml not found in ${changeDir}`));
  }
  await inspectClassicProjectTarget(classicCommandProjectRoot(), path27.join(changeDir, ".comet"), {
    label: `Classic runtime directory for ${name}`,
    expected: "directory"
  });
  const result5 = await classicValidateCommand([name], { json: false });
  if (result5.exitCode !== 0) {
    if (result5.stderr)
      process.stderr.write(result5.stderr.endsWith("\n") ? result5.stderr : `${result5.stderr}
`);
    throw new GuardFailure(red2("FATAL: .comet.yaml schema validation failed"));
  }
  const projection = await readClassicState(changeDir);
  const unknownKeys = Array.from(new Set(projection.unknownKeys)).sort();
  if (unknownKeys.length > 0) {
    throw new GuardFailure(
      red2(`FATAL: .comet.yaml has unknown field(s): ${unknownKeys.join(", ")}`)
    );
  }
}
function pushCheck(output, outcome) {
  if (outcome.passed) {
    output.stderr.push(green2(`  [PASS] ${outcome.description}`));
    if (outcome.detail) {
      for (const line of outcome.detail.split("\n")) output.stderr.push(green2(`    ${line}`));
    }
  } else {
    output.stderr.push(red2(`  [FAIL] ${outcome.description}`));
    if (outcome.detail) {
      for (const line of outcome.detail.split("\n")) output.stderr.push(red2(`    ${line}`));
    }
  }
}
function check(description, run) {
  return async () => {
    try {
      const result5 = await run();
      return {
        description,
        passed: result5.passed,
        detail: ("detail" in result5 ? result5.detail : "") ?? ""
      };
    } catch (error) {
      return {
        description,
        passed: false,
        detail: error instanceof Error ? error.message : String(error)
      };
    }
  };
}
function pass(detail) {
  return { passed: true, ...detail ? { detail } : {} };
}
function fail(detail) {
  return { passed: false, detail };
}
async function runChecks(output, builders) {
  let blocked2 = false;
  for (const build of builders) {
    const outcome = await build();
    pushCheck(output, outcome);
    if (!outcome.passed) blocked2 = true;
  }
  return blocked2;
}
var INFERRED_COMMAND_SOURCES = [
  "package.json with a build script",
  "pom.xml",
  "Cargo.toml"
];
async function removedProjectCommandField(field2) {
  try {
    const document = await readWorkflowProjectConfigDocument(classicCommandProjectRoot(), {
      allowPartialProject: true
    });
    if (!document) return false;
    return Object.prototype.hasOwnProperty.call(document.value, field2);
  } catch (error) {
    throw new Error(
      `.comet/config.yaml is invalid YAML (${error instanceof Error ? error.message : String(error)}); cannot check for removed "${field2}" field. Fix the config and retry.`,
      { cause: error }
    );
  }
}
function removedProjectCommandRun(field2) {
  return {
    status: 1,
    output: `${field2} has been removed from .comet/config.yaml. Delete this field and run any required ${field2 === "build_command" ? "build" : "verification"} command manually before retrying.`
  };
}
function runInferred(command) {
  const result5 = spawnSync2(command, {
    shell: true,
    cwd: classicCommandInvocationCwd(),
    encoding: "utf8",
    timeout: 3e5
  });
  return {
    status: result5.status ?? 1,
    output: `${result5.stdout ?? ""}${result5.stderr ?? ""}`.replace(/\n+$/u, "")
  };
}
function invocationTarget(relative) {
  return path27.resolve(classicCommandInvocationCwd(), relative);
}
async function inferredBuildCommand() {
  const packageJson2 = invocationTarget("package.json");
  if (await exists(packageJson2)) {
    const parsed = JSON.parse(
      await readClassicProjectFile(classicCommandProjectRoot(), packageJson2, {
        label: "package.json"
      })
    );
    if (typeof parsed.scripts?.build === "string") return "npm run build";
  }
  if (await exists(invocationTarget("pom.xml"))) {
    if (process.platform === "win32") {
      if (await exists(invocationTarget("mvnw.cmd"))) return "mvnw.cmd compile -q";
      return "mvn.cmd compile -q";
    }
    if (await exists(invocationTarget("mvnw"))) return "./mvnw compile -q";
    return "mvn compile -q";
  }
  if (await exists(invocationTarget("Cargo.toml"))) return "cargo build";
  return null;
}
function evidenceDetail(record2) {
  return `Evidence: recorded command-check at ${record2.timestamp}; command: ${record2.command}; cwd: ${record2.cwd}`;
}
function recoveryCommand(change, scope, command) {
  return `comet state record-check ${change} ${scope} --command "${command}" --exit-code 0`;
}
async function commandCheckPasses(changeDir, change, run, scope) {
  if (process.env.COMET_SKIP_BUILD === "1") {
    return { status: 0, output: "SKIPPED via COMET_SKIP_BUILD=1" };
  }
  const removedFields = scope === "build" ? ["build_command"] : ["verify_command", "build_command"];
  for (const removedField of removedFields) {
    if (await removedProjectCommandField(removedField)) {
      return removedProjectCommandRun(removedField);
    }
  }
  const inferred = scope === "build" ? await inferredBuildCommand() : null;
  if (inferred) return runInferred(inferred);
  const recorded = await latestCommandCheck(classicCommandProjectRoot(), changeDir, run, scope);
  if (!recorded) {
    return {
      status: 1,
      output: scope === "build" ? `No inferred build command or recorded build check. Detection searched: ${INFERRED_COMMAND_SOURCES.join(", ")}.
Next: run the required command, then record it with:
${recoveryCommand(change, scope, "<command>")}` : `No recorded verify check.
Next: run the required verification command, then record it with:
${recoveryCommand(change, scope, "<command>")}`
    };
  }
  if (recorded.exitCode !== 0) {
    return {
      status: recorded.exitCode,
      output: `Latest recorded ${scope} check failed with exit code ${recorded.exitCode}.
${evidenceDetail(recorded)}
Next: rerun the command successfully, then record it with:
${recoveryCommand(change, scope, recorded.command)}`
    };
  }
  return { status: 0, output: evidenceDetail(recorded) };
}
async function tasksAllDone(changeDir) {
  const tasks = path27.join(changeDir, "tasks.md");
  if (!await exists(tasks)) {
    return fail(
      `tasks.md is missing at ${tasks}
Next: restore or create tasks.md for this change before leaving build.`
    );
  }
  const source = await readClassicProjectFile(classicCommandProjectRoot(), tasks, {
    label: `Classic tasks ${tasks}`
  });
  if (!/- \[x\]/u.test(source)) {
    return fail(
      "tasks.md has no completed tasks.\nNext: complete implementation tasks and mark them with '- [x]'."
    );
  }
  const unfinished = source.split(/\r?\n/u).map((line, index) => ({ line, number: index + 1 })).filter((entry2) => /^- \[ \]/u.test(entry2.line));
  if (unfinished.length > 0) {
    return fail(
      `Unfinished tasks:
${unfinished.map((entry2) => `${entry2.number}:${entry2.line}`).join("\n")}
Next: complete or explicitly remove unfinished tasks, then mark tasks.md with '- [x]'.`
    );
  }
  return pass();
}
async function tasksHasAny(changeDir) {
  const tasks = path27.join(changeDir, "tasks.md");
  if (!await exists(tasks)) return false;
  return /- \[/u.test(
    await readClassicProjectFile(classicCommandProjectRoot(), tasks, {
      label: `Classic tasks ${tasks}`
    })
  );
}
async function planTasksAllDone(changeDir) {
  const plan = await readField(changeDir, "plan");
  if (!plan || plan === "null") return pass();
  if (!await exists(plan)) {
    return fail(
      `plan file is missing at ${plan}
Next: restore the Superpowers plan file or update .comet.yaml plan before leaving build.`
    );
  }
  const source = await readClassicProjectFile(classicCommandProjectRoot(), plan, {
    label: `Classic plan ${plan}`
  });
  const unfinished = source.split(/\r?\n/u).map((line, index) => ({ line, number: index + 1 })).filter((entry2) => /^\s*- \[ \]/u.test(entry2.line));
  if (unfinished.length > 0) {
    return fail(
      `Unfinished Superpowers plan tasks:
${unfinished.map((entry2) => `${entry2.number}:${entry2.line}`).join("\n")}
Next: check off corresponding completed plan tasks, then commit the plan update.`
    );
  }
  return pass();
}
async function boundBranchMatches(changeDir, change) {
  let outcome;
  try {
    outcome = await resolveBranchBinding(changeDir, {
      heal: true,
      cwd: classicCommandInvocationCwd()
    });
  } catch (error) {
    throw new GuardFailure(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  }
  switch (outcome.status) {
    case "drift":
      return fail(driftBlockedMessage(change, outcome.boundBranch, outcome.currentBranch));
    case "unbound-detached":
      return fail(unboundDetachedMessage(change));
    case "healed":
      return pass(`bound_branch lazily set to ${outcome.branch}`);
    case "needs-heal":
    case "ok":
    case "not-applicable":
      return pass();
    default: {
      const exhaustive = outcome;
      throw new Error(`unhandled branch binding status: ${JSON.stringify(exhaustive)}`);
    }
  }
}
async function isolationSelected(changeDir, change) {
  const isolation = await readField(changeDir, "isolation");
  if (isolation === "current" || isolation === "branch" || isolation === "worktree") return pass();
  const allowedValues = "<current|branch|worktree>";
  return fail(
    `isolation must be current, branch, or worktree, got '${isolation || "null"}'
Next: choose a valid workspace mode, prepare it when needed, then run:
  comet state set ${change} isolation ${allowedValues}`
  );
}
async function buildModeSelected(changeDir, change) {
  const buildMode = await readField(changeDir, "build_mode");
  if (["subagent-driven-development", "executing-plans", "direct"].includes(buildMode))
    return pass();
  return fail(
    `build_mode must be selected before leaving build, got '${buildMode || "null"}'
Next: ask the user to choose an execution mode, then run:
  comet state set ${change} build_mode <subagent-driven-development|executing-plans>`
  );
}
async function buildModeAllowedForWorkflow(changeDir) {
  const workflow = await readField(changeDir, "workflow");
  const buildMode = await readField(changeDir, "build_mode");
  const directOverride = await readField(changeDir, "direct_override");
  if (buildMode !== "direct") return pass();
  if (workflow === "hotfix" || workflow === "tweak") return pass();
  if (directOverride === "true") return pass();
  return fail(
    "build_mode=direct is only allowed for hotfix/tweak unless direct_override: true is recorded\nNext: choose executing-plans or subagent-driven-development, or stop and ask the user for an explicit direct override."
  );
}
async function subagentDispatchConfirmed(changeDir, change) {
  const buildMode = await readField(changeDir, "build_mode");
  const subagentDispatch = await readField(changeDir, "subagent_dispatch");
  if (buildMode !== "subagent-driven-development") return pass();
  if (subagentDispatch === "confirmed") return pass();
  return fail(
    `subagent_dispatch must be confirmed before using build_mode=subagent-driven-development
Next: confirm the current platform has a real background subagent/Task/multi-agent dispatcher, then run:
  comet state set ${change} subagent_dispatch confirmed
If dispatch is unavailable, return to /comet-build Step 2 with subagent-driven-development removed. When executing-plans is the only valid mode, run:
  comet state set ${change} build_mode executing-plans`
  );
}
async function tddModeSelected(changeDir, change) {
  const workflow = await readField(changeDir, "workflow");
  if (workflow === "hotfix" || workflow === "tweak") return pass();
  const tddMode = await readField(changeDir, "tdd_mode");
  if (tddMode === "tdd" || tddMode === "direct") return pass();
  return fail(
    `tdd_mode must be tdd or direct for full workflow, got '${tddMode || "null"}'
Next: ask the user to choose TDD enforcement level, then run:
  comet state set ${change} tdd_mode <tdd|direct>`
  );
}
async function reviewModeSelected(changeDir, change) {
  const workflow = await readField(changeDir, "workflow");
  if (workflow === "hotfix" || workflow === "tweak") return pass();
  const reviewMode = await readField(changeDir, "review_mode");
  if (reviewMode === "off" || reviewMode === "standard" || reviewMode === "thorough") {
    return pass();
  }
  return fail(
    `review_mode must be off, standard, or thorough before leaving build, got '${reviewMode || "null"}'
Next: ask the user to choose review strength, then run:
  comet state set ${change} review_mode <off|standard|thorough>`
  );
}
async function verificationReportExists(changeDir) {
  const report = await readField(changeDir, "verification_report");
  return Boolean(report) && report !== "null" && await exists(report);
}
async function branchStatusHandled(changeDir) {
  return await readField(changeDir, "branch_status") === "handled";
}
async function archivedIsTrue(changeDir) {
  return await readField(changeDir, "archived") === "true";
}
async function designDocFrontmatterHas(designDoc, field2, expected) {
  const source = (await readClassicProjectFile(classicCommandProjectRoot(), designDoc, {
    label: `Classic Design Doc ${designDoc}`
  })).replace(/^\uFEFF/u, "");
  let inFrontmatter = false;
  for (const line of source.split(/\r?\n/u)) {
    if (!inFrontmatter) {
      if (line === "---") inFrontmatter = true;
      continue;
    }
    if (line === "---") break;
    if (new RegExp(`^${field2}: ['"]?${expected}['"]?\\s*$`, "u").test(line)) return true;
  }
  return false;
}
async function designDocRecorded(changeDir, change) {
  const designDoc = await readField(changeDir, "design_doc");
  if (designDoc && designDoc !== "null" && await exists(designDoc)) return pass();
  return fail(
    `design_doc must point to an existing Superpowers Design Doc for full workflow before leaving design.
Next: create the Design Doc and run: comet state set ${change} design_doc <path>`
  );
}
async function designHandoffContextValid(changeDir, change) {
  const context = await readField(changeDir, "handoff_context");
  const recordedHash = await readField(changeDir, "handoff_hash");
  if (!context || context === "null") {
    return fail(
      `handoff_context is missing from .comet.yaml
Next: run node "$COMET_HANDOFF" ${change} design --write before invoking Superpowers.`
    );
  }
  if (!await nonempty(context)) {
    return fail(
      `handoff_context does not point to a non-empty file: ${context}
Next: regenerate the design handoff with comet handoff ${change} design --write.`
    );
  }
  if (!/^[a-f0-9]{64}$/u.test(recordedHash)) {
    return fail(
      `handoff_hash is missing or invalid: ${recordedHash || "null"}
Next: regenerate the design handoff with comet handoff ${change} design --write.`
    );
  }
  const actualHash = await computeHandoffHash(changeDir);
  if (actualHash !== recordedHash) {
    return fail(
      `OpenSpec artifacts changed after handoff was generated.
Expected handoff_hash: ${recordedHash}
Actual handoff_hash:   ${actualHash}
Next: run comet handoff ${change} design --write so Superpowers receives the current OpenSpec context.`
    );
  }
  const markdown = `${context.replace(/\.json$/u, "")}.md`;
  if (!await nonempty(markdown)) {
    return fail(
      `design handoff markdown is missing or empty: ${markdown}
Next: regenerate the design handoff with comet handoff ${change} design --write.`
    );
  }
  return pass();
}
async function designHandoffMarkdownTraceable(changeDir) {
  const context = await readField(changeDir, "handoff_context");
  if (!context || context === "null") return fail("handoff_context is missing from .comet.yaml");
  const markdown = `${context.replace(/\.json$/u, "")}.md`;
  if (!await nonempty(markdown))
    return fail(`design handoff markdown is missing or empty: ${markdown}`);
  const source = await readClassicProjectFile(classicCommandProjectRoot(), markdown, {
    label: `Classic handoff markdown ${markdown}`
  });
  const lines = new Set(source.split(/\r?\n/u));
  const problems = [];
  if (!/^Generated-by: comet-handoff\.sh$/mu.test(source)) {
    problems.push("handoff markdown is missing Generated-by marker");
  }
  if (!/^- Mode: (compact|full|beta)$/mu.test(source)) {
    problems.push("handoff markdown is missing Mode marker");
  }
  for (const file of await handoffSourceFiles(changeDir)) {
    if (!await exists(file)) continue;
    if (!lines.has(`- Source: ${file}`)) {
      problems.push(`handoff markdown is missing source reference: ${file}`);
    }
    if (!lines.has(`- SHA256: ${await hashFile(file)}`)) {
      problems.push(`handoff markdown is missing current sha256 for: ${file}`);
    }
  }
  return problems.length === 0 ? pass() : fail(problems.join("\n"));
}
async function contextCompressionMode(changeDir) {
  return await readField(changeDir, "context_compression") || "off";
}
async function betaSpecJsonStructurallyValid(changeDir) {
  if (await contextCompressionMode(changeDir) !== "beta") return pass();
  const context = await readField(changeDir, "handoff_context");
  if (!context || context === "null") return fail("handoff_context is missing from .comet.yaml");
  if (!await nonempty(context)) return fail(`spec-context.json is missing or empty: ${context}`);
  const source = await readClassicProjectFile(classicCommandProjectRoot(), context, {
    label: `Classic handoff context ${context}`
  });
  const problems = [];
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    return fail(
      `spec-context.json invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail("spec-context.json root must be an object");
  }
  const record2 = parsed;
  if (typeof record2.change !== "string") problems.push("spec-context.json missing 'change' field");
  if (typeof record2.phase !== "string") problems.push("spec-context.json missing 'phase' field");
  if (record2.mode !== "beta") problems.push("spec-context.json mode is not beta");
  if (typeof record2.context_hash !== "string") {
    problems.push("spec-context.json missing 'context_hash' field");
  }
  if (!Array.isArray(record2.files)) problems.push("spec-context.json missing 'files' field");
  const files = Array.isArray(record2.files) ? record2.files.filter(
    (file) => Boolean(file) && typeof file === "object" && !Array.isArray(file)
  ) : [];
  for (const file of await handoffSourceFiles(changeDir)) {
    if (!await exists(file)) continue;
    if (!files.some((entry2) => entry2.path === file && typeof entry2.sha256 === "string")) {
      problems.push(`spec-context.json missing source file reference: ${file}`);
    }
  }
  return problems.length === 0 ? pass() : fail(problems.join("\n"));
}
async function guardOpenChecks(output, changeDir) {
  const workflow = await readField(changeDir, "workflow");
  const checks = [
    check(
      "proposal.md exists and non-empty",
      async () => await nonempty(path27.join(changeDir, "proposal.md")) ? pass() : fail("")
    ),
    check(
      "proposal.md matches configured language",
      () => documentLanguageMatchesConfigured(changeDir, path27.join(changeDir, "proposal.md"))
    ),
    check(
      "tasks.md exists and non-empty",
      async () => await nonempty(path27.join(changeDir, "tasks.md")) ? pass() : fail("")
    ),
    check(
      "tasks.md matches configured language",
      () => documentLanguageMatchesConfigured(changeDir, path27.join(changeDir, "tasks.md"))
    ),
    check(
      "tasks.md has at least one task",
      async () => await tasksHasAny(changeDir) ? pass() : fail("")
    )
  ];
  if (workflow === "full") {
    checks.splice(
      1,
      0,
      check(
        "design.md exists and non-empty",
        async () => await nonempty(path27.join(changeDir, "design.md")) ? pass() : fail("")
      ),
      check(
        "design.md matches configured language",
        () => documentLanguageMatchesConfigured(changeDir, path27.join(changeDir, "design.md"))
      )
    );
  }
  return runChecks(output, checks);
}
async function guardDesignChecks(output, changeDir, change) {
  const designDoc = await readField(changeDir, "design_doc");
  const workflow = await readField(changeDir, "workflow");
  const builders = [
    check(
      "proposal.md exists",
      async () => await nonempty(path27.join(changeDir, "proposal.md")) ? pass() : fail("")
    ),
    check(
      "proposal.md matches configured language",
      () => documentLanguageMatchesConfigured(changeDir, path27.join(changeDir, "proposal.md"))
    ),
    check(
      "design.md exists",
      async () => await nonempty(path27.join(changeDir, "design.md")) ? pass() : fail("")
    ),
    check(
      "design.md matches configured language",
      () => documentLanguageMatchesConfigured(changeDir, path27.join(changeDir, "design.md"))
    ),
    check(
      "tasks.md exists",
      async () => await nonempty(path27.join(changeDir, "tasks.md")) ? pass() : fail("")
    ),
    check(
      "tasks.md matches configured language",
      () => documentLanguageMatchesConfigured(changeDir, path27.join(changeDir, "tasks.md"))
    ),
    check("design handoff context exists", () => designHandoffContextValid(changeDir, change)),
    check("design handoff markdown is traceable", () => designHandoffMarkdownTraceable(changeDir))
  ];
  if (await contextCompressionMode(changeDir) === "beta") {
    builders.push(
      check(
        "beta spec-context.json is structurally valid",
        () => betaSpecJsonStructurallyValid(changeDir)
      )
    );
  }
  if (workflow === "full") {
    builders.push(
      check("design_doc is recorded for full workflow", () => designDocRecorded(changeDir, change))
    );
  }
  let blocked2 = await runChecks(output, builders);
  if (designDoc && designDoc !== "null") {
    blocked2 = await runChecks(output, [
      check(
        `Design Doc (${designDoc}) exists`,
        async () => await nonempty(designDoc) ? pass() : fail("")
      ),
      check(
        "Design Doc matches configured language",
        () => documentLanguageMatchesConfigured(changeDir, designDoc)
      ),
      check("Design Doc frontmatter links current change", async () => {
        if (!await nonempty(designDoc)) return fail("");
        return await designDocFrontmatterHas(designDoc, "comet_change", change) ? pass() : fail("");
      }),
      check("Design Doc declares technical design role", async () => {
        if (!await nonempty(designDoc)) return fail("");
        return await designDocFrontmatterHas(designDoc, "role", "technical-design") ? pass() : fail("");
      }),
      check("Design Doc declares OpenSpec as canonical spec", async () => {
        if (!await nonempty(designDoc)) return fail("");
        return await designDocFrontmatterHas(designDoc, "canonical_spec", "openspec") ? pass() : fail("");
      })
    ]) || blocked2;
  } else if (workflow !== "full") {
    output.stderr.push(
      yellow2("  [WARN] No design_doc recorded in .comet.yaml (optional for hotfix/tweak)")
    );
  }
  return blocked2;
}
async function guardBuildChecks(output, changeDir, change, run) {
  return runChecks(output, [
    check("bound branch matches workspace mode", () => boundBranchMatches(changeDir, change)),
    check("isolation selected", () => isolationSelected(changeDir, change)),
    check("build_mode selected", () => buildModeSelected(changeDir, change)),
    check("build_mode allowed for workflow", () => buildModeAllowedForWorkflow(changeDir)),
    check("subagent dispatch confirmed", () => subagentDispatchConfirmed(changeDir, change)),
    check("tdd_mode selected", () => tddModeSelected(changeDir, change)),
    check("review_mode selected", () => reviewModeSelected(changeDir, change)),
    check("tasks.md all tasks checked", () => tasksAllDone(changeDir)),
    check("Superpowers plan all tasks checked", () => planTasksAllDone(changeDir)),
    check(
      "proposal.md exists",
      async () => await nonempty(path27.join(changeDir, "proposal.md")) ? pass() : fail("")
    ),
    check(
      "proposal.md matches configured language",
      () => documentLanguageMatchesConfigured(changeDir, path27.join(changeDir, "proposal.md"))
    ),
    check("Superpowers plan matches configured language", async () => {
      const plan = await readField(changeDir, "plan");
      if (!plan || plan === "null" || !await exists(plan)) return pass();
      return documentLanguageMatchesConfigured(changeDir, plan);
    }),
    // Build check runs last — only after all config checks pass — to avoid
    // wasting time on a build that would be rejected by a config failure.
    check("Build passes", async () => {
      const buildResult = await commandCheckPasses(changeDir, change, run, "build");
      return buildResult.status === 0 ? pass(buildResult.output) : fail(buildResult.output);
    })
  ]);
}
async function guardVerifyChecks(output, changeDir, change, run) {
  return runChecks(output, [
    check("bound branch matches workspace mode", () => boundBranchMatches(changeDir, change)),
    check("tasks.md all tasks checked", () => tasksAllDone(changeDir)),
    // Verification command runs after tasks check — no point running tests
    // if tasks.md is incomplete.
    check("Verification passes", async () => {
      const verifyResult = await commandCheckPasses(changeDir, change, run, "verify");
      return verifyResult.status === 0 ? pass(verifyResult.output) : fail(verifyResult.output);
    }),
    check(
      "verification_report exists",
      async () => await verificationReportExists(changeDir) ? pass() : fail("")
    ),
    check("verification_report matches configured language", async () => {
      const report = await readField(changeDir, "verification_report");
      if (!report || report === "null" || !await exists(report)) return pass();
      return documentLanguageMatchesConfigured(changeDir, report);
    })
  ]);
}
async function guardArchiveChecks(output, changeDir, change) {
  return runChecks(output, [
    check("bound branch matches workspace mode", () => boundBranchMatches(changeDir, change)),
    check("archived is true", async () => await archivedIsTrue(changeDir) ? pass() : fail("")),
    check(
      "proposal.md exists",
      async () => await nonempty(path27.join(changeDir, "proposal.md")) ? pass() : fail("")
    ),
    check(
      "design.md exists",
      async () => await nonempty(path27.join(changeDir, "design.md")) ? pass() : fail("")
    ),
    check("tasks.md all tasks checked", () => tasksAllDone(changeDir)),
    check(
      "branch_status=handled",
      async () => await branchStatusHandled(changeDir) ? pass() : fail("")
    )
  ]);
}
async function applyStateUpdate(output, change, changeDir, phase) {
  const event = CLASSIC_GUARD_TRANSITION_EVENT[phase];
  if (!event) return;
  const context = await ensureClassicRuntimeRun(changeDir);
  const result5 = applyClassicTransition(context.classic, event);
  await transitionClassicRuntimeRun(changeDir, result5.classic, context.run, {
    event,
    phase,
    source: "comet-guard"
  });
  await appendClassicStateEvent(changeDir, {
    change,
    event,
    source: "comet-guard",
    from: context.classic,
    to: result5.classic,
    effects: result5.effects
  });
  for (const effect of result5.effects) {
    output.stderr.push(green2(`[SET] ${wireField(effect.field)}=${wireValue(effect.to)}`));
  }
  output.stderr.push(green2(`[TRANSITION] ${event}`));
  const template = APPLY_MESSAGE[phase];
  const message = phase === "open" ? template.replace("PLACEHOLDER", result5.classic.phase) : template;
  output.stderr.push(green2(message));
}
var classicGuardCommand = async (args, options) => withClassicCommandContext(options, async () => {
  const output = new GuardOutput();
  const [change, phase, flag] = args;
  try {
    validateChangeName2(change);
    if (!phase || !PHASES2.includes(phase)) {
      throw new GuardFailure(
        `${red2(`Unknown phase: ${phase ?? ""}`)}
Valid phases: open, design, build, verify, archive`
      );
    }
    await assertClassicLayoutWritable(classicCommandProjectRoot());
    const changeDir = await resolveChangeDir(change);
    await preflight(changeDir, change);
    const runContext = await ensureClassicRuntimeRun(changeDir);
    const diagnostic = await inspectClassicChange(changeDir, change);
    if (options.json) {
      output.diagnostics = {
        change,
        phase,
        currentStep: diagnostic.currentStep,
        runtimeEval: diagnostic.runtimeEval
      };
    }
    output.stderr.push(PHASE_HEADER[phase]);
    let blocked2;
    if (phase === "open") blocked2 = await guardOpenChecks(output, changeDir);
    else if (phase === "design") blocked2 = await guardDesignChecks(output, changeDir, change);
    else if (phase === "build")
      blocked2 = await guardBuildChecks(output, changeDir, change, runContext.run);
    else if (phase === "verify")
      blocked2 = await guardVerifyChecks(output, changeDir, change, runContext.run);
    else blocked2 = await guardArchiveChecks(output, changeDir, change);
    if (blocked2) {
      output.stderr.push("");
      output.stderr.push(red2("BLOCKED — fix failing checks before proceeding to next phase"));
      return output.toResult(1);
    }
    output.stderr.push("");
    output.stderr.push(green2("ALL CHECKS PASSED — ready for next phase"));
    if (flag === "--apply") {
      await applyStateUpdate(output, change, changeDir, phase);
    }
    return output.toResult(0);
  } catch (error) {
    if (error instanceof GuardFailure) {
      for (const line of error.message.split("\n")) output.stderr.push(line);
      return output.toResult(error.exitCode);
    }
    throw error;
  }
});

// domains/comet-classic/classic-handoff.ts
var import_yaml8 = __toESM(require_dist(), 1);
import { createHash as createHash8 } from "crypto";
import { promises as fs19 } from "fs";
import path28 from "path";
var GREEN4 = "\x1B[32m";
var RED4 = "\x1B[31m";
var YELLOW4 = "\x1B[33m";
var RESET4 = "\x1B[0m";
function green3(message) {
  return `${GREEN4}${message}${RESET4}`;
}
function red3(message) {
  return `${RED4}${message}${RESET4}`;
}
function yellow3(message) {
  return `${YELLOW4}${message}${RESET4}`;
}
var HandoffFailure = class extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
  exitCode;
};
var HandoffOutput = class {
  stdout = [];
  stderr = [];
  toResult(exitCode = 0) {
    return {
      exitCode,
      ...this.stdout.length > 0 ? { stdout: this.stdout.join("\n") + "\n" } : {},
      ...this.stderr.length > 0 ? { stderr: this.stderr.join("\n") + "\n" } : {}
    };
  }
};
async function readProtectedIfExists(projectRoot, file, label) {
  if (!await classicProjectTargetExists(projectRoot, file, {
    label,
    expected: "file"
  })) {
    return null;
  }
  return readClassicProjectFile(projectRoot, file, { label });
}
async function writeProtectedText(projectRoot, file, content, label) {
  await writeClassicProjectText(projectRoot, file, content, { label });
}
function validateChangeName3(name) {
  const error = openSpecChangeNameError(name);
  if (error) throw new HandoffFailure(red3(`ERROR: ${error}`));
}
function hashText2(content) {
  return createHash8("sha256").update(content).digest("hex");
}
function artifactsHash2(artifacts) {
  return hashText2(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(artifacts).sort(([left], [right]) => left.localeCompare(right))
      )
    )
  );
}
async function handoffSourceFiles2(projectRoot, changeDir) {
  const files = [`${changeDir}/proposal.md`, `${changeDir}/design.md`, `${changeDir}/tasks.md`];
  const specs = `${changeDir}/specs`;
  const specsInspection = await inspectClassicProjectTarget(projectRoot, specs, {
    label: "Classic handoff specs directory",
    expected: "directory"
  });
  if (specsInspection.exists) {
    const entries = (await fs19.readdir(specs, { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name)
    );
    for (const entry2 of entries) {
      if (!entry2.isDirectory() && !entry2.isSymbolicLink()) continue;
      const spec = `${specs}/${entry2.name}/spec.md`;
      const specDirectory = await inspectClassicProjectTarget(
        projectRoot,
        `${specs}/${entry2.name}`,
        {
          label: `Classic handoff spec directory ${entry2.name}`,
          expected: "directory"
        }
      );
      if (!specDirectory.exists) continue;
      if (await classicProjectTargetExists(projectRoot, spec, {
        label: `Classic handoff spec ${entry2.name}`,
        expected: "file"
      })) {
        files.push(spec);
      }
    }
  }
  return files;
}
function handoffSourceReference(changeDir, changeRef, file) {
  const relative = path28.relative(changeDir, file).replaceAll("\\", "/");
  return `${changeRef}/${relative}`;
}
async function computeContextHash(projectRoot, changeDir, changeRef) {
  const lines = [];
  for (const file of await handoffSourceFiles2(projectRoot, changeDir)) {
    const reference = handoffSourceReference(changeDir, changeRef, file);
    const content = await readProtectedIfExists(
      projectRoot,
      file,
      `Classic handoff source ${reference}`
    );
    if (content === null) continue;
    lines.push(`path:${reference}`, `sha256:${hashText2(content)}`);
  }
  return createHash8("sha256").update(lines.join("\n")).digest("hex");
}
function jsonEscape(value) {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}
function lineCount(content) {
  return (content.match(/\n/gu) ?? []).length;
}
function firstLines(content, max) {
  let count = 0;
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === "\n") {
      count += 1;
      if (count === max) return content.slice(0, i + 1);
    }
  }
  return content;
}
async function writeMarkdownContext(projectRoot, changeDir, changeRef, change, mode, contextHash, output) {
  const lines = [
    "# Comet Design Handoff",
    "",
    `- Change: ${change}`,
    "- Phase: design",
    `- Mode: ${mode}`,
    `- Context hash: ${contextHash}`,
    "",
    "Generated-by: comet-handoff.sh",
    "",
    "OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.",
    ""
  ];
  for (const file of await handoffSourceFiles2(projectRoot, changeDir)) {
    const reference = handoffSourceReference(changeDir, changeRef, file);
    const content = await readProtectedIfExists(
      projectRoot,
      file,
      `Classic handoff source ${reference}`
    );
    if (content === null) continue;
    const total = lineCount(content);
    lines.push(
      `## ${reference}`,
      "",
      `- Source: ${reference}`,
      `- Lines: 1-${total}`,
      `- SHA256: ${hashText2(content)}`,
      ""
    );
    if (mode === "full" || total <= 80) {
      lines.push("```md", content, "```");
    } else {
      lines.push(
        "[TRUNCATED]",
        "",
        "```md",
        firstLines(content, 80),
        "```",
        "",
        `Full source: ${reference}`
      );
    }
    lines.push("");
  }
  await writeProtectedText(
    projectRoot,
    output,
    lines.join("\n"),
    "Classic handoff markdown output"
  );
}
async function writeJsonContext(projectRoot, changeDir, changeRef, change, mode, contextHash, output) {
  const entries = [];
  for (const file of await handoffSourceFiles2(projectRoot, changeDir)) {
    const reference = handoffSourceReference(changeDir, changeRef, file);
    const content = await readProtectedIfExists(
      projectRoot,
      file,
      `Classic handoff source ${reference}`
    );
    if (content === null) continue;
    entries.push(`    { "path": "${jsonEscape(reference)}", "sha256": "${hashText2(content)}" }`);
  }
  const filesBlock = entries.join(",\n");
  const document = [
    "{",
    `  "change": "${jsonEscape(change)}",`,
    '  "phase": "design",',
    `  "mode": "${mode}",`,
    '  "canonical_spec": "openspec",',
    '  "generated_by": "comet-handoff.sh",',
    `  "context_hash": "${contextHash}",`,
    '  "files": [',
    filesBlock,
    "  ]",
    "}",
    ""
  ].join("\n");
  await writeProtectedText(projectRoot, output, document, "Classic handoff JSON output");
}
async function writeSpecProjectionForFile(reference, content) {
  return [
    `## ${reference}`,
    "",
    `- Source: ${reference}`,
    `- Lines: 1-${lineCount(content)}`,
    `- SHA256: ${hashText2(content)}`,
    "",
    "```md",
    content,
    "```",
    ""
  ];
}
async function writeSpecMarkdownContext(projectRoot, changeDir, changeRef, change, contextHash, output) {
  const lines = [
    "# Comet Spec Context",
    "",
    `- Change: ${change}`,
    "- Phase: design",
    "- Mode: beta",
    `- Context hash: ${contextHash}`,
    "",
    "Generated-by: comet-handoff.sh",
    "",
    "OpenSpec remains the canonical capability spec. This beta context pack verbatim-projects spec files and references supporting artifacts by hash, not an agent-authored summary.",
    "",
    "## Source References",
    ""
  ];
  for (const file of await handoffSourceFiles2(projectRoot, changeDir)) {
    const reference = handoffSourceReference(changeDir, changeRef, file);
    const content = await readProtectedIfExists(
      projectRoot,
      file,
      `Classic handoff source ${reference}`
    );
    if (content === null) continue;
    lines.push(`- Source: ${reference}`, `- SHA256: ${hashText2(content)}`);
  }
  lines.push("", "## Acceptance Projection", "");
  const specs = `${changeDir}/specs`;
  let projected = false;
  const specsInspection = await inspectClassicProjectTarget(projectRoot, specs, {
    label: "Classic handoff specs directory",
    expected: "directory"
  });
  if (specsInspection.exists) {
    const entries = (await fs19.readdir(specs, { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name)
    );
    for (const entry2 of entries) {
      if (!entry2.isDirectory() && !entry2.isSymbolicLink()) continue;
      const spec = `${specs}/${entry2.name}/spec.md`;
      const content = await readProtectedIfExists(
        projectRoot,
        spec,
        `Classic handoff spec ${entry2.name}`
      );
      if (content === null) continue;
      projected = true;
      lines.push(
        ...await writeSpecProjectionForFile(
          handoffSourceReference(changeDir, changeRef, spec),
          content
        )
      );
    }
  }
  if (!projected) {
    lines.push("No delta spec files found.", "");
  }
  lines.push(
    "Full source files remain canonical. If a required heading or scenario is missing here, regenerate the handoff or read the source spec directly. Supporting files (proposal, design, tasks) are referenced by hash only."
  );
  await writeProtectedText(
    projectRoot,
    output,
    lines.join("\n"),
    "Classic handoff spec markdown output"
  );
}
async function writeSpecJsonContext(projectRoot, changeDir, changeRef, change, contextHash, output) {
  const entries = [];
  for (const file of await handoffSourceFiles2(projectRoot, changeDir)) {
    const reference = handoffSourceReference(changeDir, changeRef, file);
    const content = await readProtectedIfExists(
      projectRoot,
      file,
      `Classic handoff source ${reference}`
    );
    if (content === null) continue;
    const role = /\/specs\/[^/]+\/spec\.md$/u.test(reference) ? "spec" : "supporting";
    entries.push({ path: reference, sha256: hashText2(content), role });
  }
  await writeProtectedText(
    projectRoot,
    output,
    `${JSON.stringify(
      {
        change,
        phase: "design",
        mode: "beta",
        canonical_spec: "openspec",
        generated_by: "comet-handoff.sh",
        context_hash: contextHash,
        files: entries
      },
      null,
      2
    )}
`,
    "Classic handoff spec JSON output"
  );
}
async function readField2(projectRoot, changeDir, field2) {
  const file = path28.join(changeDir, ".comet.yaml");
  const document = (0, import_yaml8.parseDocument)(
    await readClassicProjectFile(projectRoot, file, { label: "Classic change state" }),
    { uniqueKeys: false }
  );
  if (document.errors.length > 0) {
    throw new HandoffFailure(`ERROR: Invalid .comet.yaml: ${document.errors[0].message}`);
  }
  const record2 = document.toJS();
  const value = record2[field2];
  if (value === null || value === void 0) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
async function appendRecoveryEvent2(changeDir, run, actionId) {
  const trajectory = await readTrajectory(changeDir, run.trajectoryRef);
  const alreadyRecorded = trajectory.some(
    (event) => event.type === "recovery_reconciled" && event.data.kind === "classic-handoff" && event.data.actionId === actionId
  );
  if (alreadyRecorded) return;
  await appendTrajectory(changeDir, run.trajectoryRef, {
    sequence: trajectory.length + 1,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    type: "recovery_reconciled",
    runId: run.runId,
    data: {
      kind: "classic-handoff",
      actionId
    }
  });
}
async function completedHandoffIsCurrent(projectRoot, changeDir, run, contextHash, contextJson, contextMd, contextJsonRef, contextMdRef) {
  const [context, artifacts, checkpoint] = await Promise.all([
    readContext(changeDir, run.contextRef),
    readArtifacts(changeDir, run.artifactsRef),
    readCheckpoint(changeDir, run.checkpointRef)
  ]);
  const [contextJsonContent, contextMdContent] = await Promise.all([
    readProtectedIfExists(projectRoot, contextJson, "Classic handoff JSON output"),
    readProtectedIfExists(projectRoot, contextMd, "Classic handoff markdown output")
  ]);
  if (contextJsonContent === null || contextMdContent === null) return false;
  if (context !== contextMdContent) return false;
  if (artifacts.handoff_context !== contextJsonRef || artifacts.handoff_markdown !== contextMdRef) {
    return false;
  }
  return checkpoint?.runId === run.runId && checkpoint.contextHash === (context === null ? null : hashText2(context)) && checkpoint.artifactsHash === artifactsHash2(artifacts) && contextHash.length === 64;
}
var classicHandoffCommand = async (args, options) => withClassicCommandContext(options, async () => {
  const output = new HandoffOutput();
  const [change, phase, mode, fullFlag] = args;
  try {
    validateChangeName3(change);
    const layout = await assertClassicLayoutWritable(classicCommandProjectRoot());
    const active = await inspectClassicActiveChangeDirectory(change, layout.projectRoot);
    const changeDir = active.directory;
    const changeRef = classicProjectRelative(layout.projectRoot, changeDir);
    if (phase === "--hash-only") {
      if (!active.exists) {
        throw new HandoffFailure(red3(`ERROR: change directory not found: ${changeRef}`));
      }
      for (const required2 of ["proposal.md", "design.md", "tasks.md"]) {
        if (!await classicProjectFileNonempty(
          layout.projectRoot,
          `${changeDir}/${required2}`,
          `Classic handoff source ${required2}`
        )) {
          throw new HandoffFailure(
            red3(`ERROR: required file missing or empty: ${changeRef}/${required2}`)
          );
        }
      }
      output.stdout.push(await computeContextHash(layout.projectRoot, changeDir, changeRef));
      return output.toResult(0);
    }
    if (phase !== "design" || mode !== "--write") {
      throw new HandoffFailure(
        red3("Usage: comet-handoff.mjs <change-name> design --write [--full]")
      );
    }
    let handoffMode;
    if (fullFlag === void 0 || fullFlag === "") handoffMode = "compact";
    else if (fullFlag === "--full") handoffMode = "full";
    else
      throw new HandoffFailure(
        red3("Usage: comet-handoff.mjs <change-name> design --write [--full]")
      );
    if (!active.exists) {
      throw new HandoffFailure(red3(`ERROR: change directory not found: ${changeRef}`));
    }
    if (!active.stateExists) {
      throw new HandoffFailure(red3(`ERROR: .comet.yaml not found at ${changeRef}/.comet.yaml`));
    }
    if (await readField2(layout.projectRoot, changeDir, "phase") !== "design") {
      throw new HandoffFailure(red3("ERROR: design handoff requires phase: design"));
    }
    for (const required2 of ["proposal.md", "design.md", "tasks.md"]) {
      if (!await classicProjectFileNonempty(
        layout.projectRoot,
        `${changeDir}/${required2}`,
        `Classic handoff source ${required2}`
      )) {
        throw new HandoffFailure(
          red3(`ERROR: required OpenSpec artifact missing or empty: ${changeRef}/${required2}`)
        );
      }
    }
    const handoffDir = `${changeDir}/.comet/handoff`;
    await inspectClassicProjectTarget(layout.projectRoot, `${changeDir}/.comet`, {
      label: "Classic change runtime directory",
      expected: "directory"
    });
    await inspectClassicProjectTarget(layout.projectRoot, handoffDir, {
      label: "Classic handoff directory",
      expected: "directory"
    });
    const contextCompression2 = await readField2(layout.projectRoot, changeDir, "context_compression") || "off";
    let contextJson;
    let contextMd;
    if (contextCompression2 === "off") {
      contextJson = `${handoffDir}/design-context.json`;
      contextMd = `${handoffDir}/design-context.md`;
    } else if (contextCompression2 === "beta") {
      if (handoffMode === "full") {
        output.stderr.push(
          yellow3("[HANDOFF] --full is ignored in beta mode; spec files are projected verbatim")
        );
      }
      handoffMode = "beta";
      contextJson = `${handoffDir}/spec-context.json`;
      contextMd = `${handoffDir}/spec-context.md`;
    } else {
      throw new HandoffFailure(
        [
          red3(`ERROR: invalid context_compression: ${contextCompression2}`),
          red3("Valid values: off, beta")
        ].join("\n")
      );
    }
    const contextJsonRef = classicProjectRelative(layout.projectRoot, contextJson);
    const contextMdRef = classicProjectRelative(layout.projectRoot, contextMd);
    const contextHash = await computeContextHash(layout.projectRoot, changeDir, changeRef);
    const actionId = `classic-handoff:${contextHash}`;
    const initialProjection = await readClassicState(changeDir);
    if (!initialProjection.classic) {
      throw new HandoffFailure(red3("ERROR: design handoff requires Classic state"));
    }
    const initialPending = initialProjection.run ? await readPendingAction(changeDir, initialProjection.run.pendingRef) : null;
    const recovering = initialPending?.id === actionId && initialPending.type === "handoff" && initialPending.ref === contextHash;
    if (initialProjection.classic.handoffHash && initialProjection.classic.handoffHash !== contextHash && !recovering) {
      throw new HandoffFailure(
        red3(
          `ERROR: stale handoff detected: source hash ${contextHash} does not match completed hash ${initialProjection.classic.handoffHash}`
        )
      );
    }
    await ensureClassicProjectDirectory(
      layout.projectRoot,
      `${changeDir}/.comet`,
      "Classic change runtime directory"
    );
    await ensureClassicProjectDirectory(
      layout.projectRoot,
      handoffDir,
      "Classic handoff directory"
    );
    const runtime = await ensureClassicRuntimeRun(changeDir);
    const pendingAction = await readPendingAction(changeDir, runtime.run.pendingRef);
    const resumesPending = pendingAction?.id === actionId && pendingAction.type === "handoff" && pendingAction.ref === contextHash;
    if (runtime.run.pending && runtime.run.pending !== actionId) {
      throw new HandoffFailure(red3(`ERROR: another action is pending: ${runtime.run.pending}`));
    }
    if (runtime.classic.handoffHash === contextHash && runtime.classic.handoffContext === contextJsonRef && !runtime.run.pending && !pendingAction && await completedHandoffIsCurrent(
      layout.projectRoot,
      changeDir,
      runtime.run,
      contextHash,
      contextJson,
      contextMd,
      contextJsonRef,
      contextMdRef
    )) {
      output.stderr.push(green3(`[HANDOFF] wrote ${contextJsonRef}`));
      output.stderr.push(green3(`[HANDOFF] wrote ${contextMdRef}`));
      output.stderr.push(green3(`[HANDOFF] handoff_hash=${contextHash}`));
      return output.toResult(0);
    }
    const action = {
      id: actionId,
      stepId: runtime.run.currentStep,
      type: "handoff",
      ref: contextHash
    };
    await writePendingAction(changeDir, runtime.run.pendingRef, action);
    const pendingRun = {
      ...runtime.run,
      pending: actionId,
      status: "waiting"
    };
    await writeClassicState(changeDir, {
      classic: runtime.classic,
      run: pendingRun,
      unknownKeys: (await readClassicState(changeDir)).unknownKeys
    });
    if (handoffMode === "beta") {
      await writeSpecMarkdownContext(
        layout.projectRoot,
        changeDir,
        changeRef,
        change,
        contextHash,
        contextMd
      );
      await writeSpecJsonContext(
        layout.projectRoot,
        changeDir,
        changeRef,
        change,
        contextHash,
        contextJson
      );
    } else {
      await writeMarkdownContext(
        layout.projectRoot,
        changeDir,
        changeRef,
        change,
        handoffMode,
        contextHash,
        contextMd
      );
      await writeJsonContext(
        layout.projectRoot,
        changeDir,
        changeRef,
        change,
        handoffMode,
        contextHash,
        contextJson
      );
    }
    const context = await readClassicProjectFile(layout.projectRoot, contextMd, {
      label: "Classic handoff markdown output"
    });
    await writeContext(changeDir, pendingRun.contextRef, context);
    const artifacts = {
      ...await readArtifacts(changeDir, pendingRun.artifactsRef),
      handoff_context: contextJsonRef,
      handoff_markdown: contextMdRef
    };
    await writeArtifacts(changeDir, pendingRun.artifactsRef, artifacts);
    const completedClassic = {
      ...runtime.classic,
      handoffContext: contextJsonRef,
      handoffHash: contextHash
    };
    const transitionedRun = pendingRun.currentStep === "full.design.handoff" ? await transitionClassicRuntimeRun(changeDir, completedClassic, pendingRun, {
      actionId,
      kind: "classic-handoff"
    }) : pendingRun;
    const completedRun = {
      ...transitionedRun,
      pending: null,
      status: "running"
    };
    if (recovering || resumesPending) {
      await appendRecoveryEvent2(changeDir, completedRun, actionId);
    }
    const trajectory = await readTrajectory(changeDir, completedRun.trajectoryRef);
    const checkpoint = {
      runId: completedRun.runId,
      stateVersion: completedRun.iteration,
      trajectoryOffset: trajectory.length,
      contextHash: hashText2(context),
      artifactsHash: artifactsHash2(artifacts),
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await writeCheckpoint(changeDir, completedRun.checkpointRef, checkpoint);
    await writeClassicState(changeDir, {
      classic: completedClassic,
      run: completedRun,
      unknownKeys: (await readClassicState(changeDir)).unknownKeys
    });
    await clearPendingAction(changeDir, completedRun.pendingRef);
    output.stderr.push(green3(`[SET] handoff_context=${contextJson}`));
    output.stderr.push(green3(`[SET] handoff_hash=${contextHash}`));
    output.stderr.push(green3(`[HANDOFF] wrote ${contextJsonRef}`));
    output.stderr.push(green3(`[HANDOFF] wrote ${contextMdRef}`));
    output.stderr.push(green3(`[HANDOFF] handoff_hash=${contextHash}`));
    return output.toResult(0);
  } catch (error) {
    if (error instanceof HandoffFailure) {
      for (const line of error.message.split("\n")) output.stderr.push(line);
      return output.toResult(error.exitCode);
    }
    throw error;
  }
});

// domains/comet-classic/classic-hook-guard.ts
import { promises as fs20, readFileSync } from "fs";
import path29 from "path";
function result(exitCode, message) {
  return { exitCode, stderr: message + "\n" };
}
function allowed(message) {
  return result(0, `[COMET-HOOK] allowed: ${message}`);
}
function inputTarget() {
  if (process.env.FILE_PATH) return process.env.FILE_PATH;
  if (process.stdin.isTTY) return "";
  const input = readFileSync(0, "utf8");
  if (!input) return "";
  try {
    const parsed = JSON.parse(input);
    return typeof parsed.tool_input?.file_path === "string" ? parsed.tool_input.file_path : "";
  } catch {
    return "";
  }
}
function normalized(value) {
  return value.replaceAll("\\", "/").replace(/\/+/gu, "/");
}
function comparisonKey(value) {
  const normalizedValue = normalized(value);
  return process.platform === "win32" ? normalizedValue.toLowerCase() : normalizedValue;
}
function parseProjectRoot(args) {
  const index = args.indexOf("--project-root");
  const value = index >= 0 ? args[index + 1] : void 0;
  return path29.resolve(value && !value.startsWith("--") ? value : process.cwd());
}
function relativeToProjectRoot(target, projectRoot) {
  const relative = normalized(path29.relative(projectRoot, target));
  if (relative === "") return "";
  if (relative.startsWith("../") || relative === ".." || path29.isAbsolute(relative)) return null;
  return relative;
}
async function physicalPathForPossiblyMissingTarget(target) {
  const resolved = path29.resolve(target);
  const root = path29.parse(resolved).root;
  const missingSegments = [];
  let cursor = resolved;
  while (cursor && cursor !== root) {
    try {
      const physicalBase = await fs20.realpath(cursor);
      return path29.join(physicalBase, ...missingSegments.reverse());
    } catch (error) {
      const code = error.code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      missingSegments.push(path29.basename(cursor));
      cursor = path29.dirname(cursor);
    }
  }
  try {
    const physicalRoot = await fs20.realpath(root);
    return path29.join(physicalRoot, ...missingSegments.reverse());
  } catch {
    return null;
  }
}
async function projectRelative(target, projectRoot) {
  const rawCandidate = path29.isAbsolute(target) ? target : path29.resolve(process.cwd(), target);
  let candidate = normalized(rawCandidate);
  const rootRelative = relativeToProjectRoot(rawCandidate, projectRoot);
  if (rootRelative !== null) return rootRelative;
  try {
    const physicalCandidate = await physicalPathForPossiblyMissingTarget(rawCandidate);
    const physicalRoot = await fs20.realpath(projectRoot);
    if (physicalCandidate) {
      const physicalRootRelative = relativeToProjectRoot(physicalCandidate, physicalRoot);
      if (physicalRootRelative !== null) return physicalRootRelative;
      candidate = normalized(physicalCandidate);
    }
  } catch {
    if (!path29.isAbsolute(target)) return normalized(target).replace(/^\.\//u, "");
  }
  return candidate.replace(/^\.\//u, "");
}
async function loadGoverningChange(changeDir) {
  try {
    const projection = await readClassicState(changeDir, { migrate: false });
    const unknownKeys = Array.from(new Set(projection.unknownKeys)).sort();
    if (unknownKeys.length > 0) {
      throw new Error(`Invalid Classic state: unknown field(s): ${unknownKeys.join(", ")}`);
    }
    if (!projection.classic) throw new Error("Classic state projection is unavailable");
    return {
      changeDir,
      phase: projection.classic.phase,
      classic: projection.classic,
      archived: projection.classic.archived
    };
  } catch {
    const legacy = await readLegacyState(changeDir);
    if (!legacy.phase) return null;
    return {
      changeDir,
      phase: legacy.phase,
      classic: null,
      archived: legacy.archived
    };
  }
}
async function activeChanges(projectRoot) {
  const changesDir = (await assertClassicLayoutReadable(projectRoot)).changesDir;
  const governingChanges = [];
  const changesInspection = await inspectClassicProjectTarget(projectRoot, changesDir, {
    label: "Classic changes directory",
    expected: "directory"
  });
  if (!changesInspection.exists) return governingChanges;
  for (const entry2 of (await fs20.readdir(changesDir, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name)
  )) {
    if (entry2.name === "archive") continue;
    if (openSpecChangeNameError(entry2.name)) continue;
    const active = await inspectClassicActiveChangeDirectory(entry2.name, projectRoot);
    if (!active.exists || !active.stateExists) continue;
    const governing = await loadGoverningChange(active.directory);
    if (!governing || governing.archived) continue;
    governingChanges.push(governing);
  }
  return governingChanges;
}
function superpowersArtifactPrefix(projectRoot, layout) {
  return `${classicProjectRelative(projectRoot, layout.superpowersRoot)}/`;
}
function isSuperpowersArtifactPath(relativePath2, prefix) {
  return comparisonKey(relativePath2).startsWith(comparisonKey(prefix));
}
function superpowersArtifactSlots(projectRoot, layout) {
  return [
    {
      prefix: `${classicProjectRelative(projectRoot, layout.superpowersSpecsDir)}/`,
      field: "designDoc",
      wireField: "design_doc",
      phase: "design"
    },
    {
      prefix: `${classicProjectRelative(projectRoot, layout.superpowersPlansDir)}/`,
      field: "plan",
      wireField: "plan",
      phase: "build"
    },
    {
      prefix: `${classicProjectRelative(projectRoot, layout.superpowersReportsDir)}/`,
      field: "verificationReport",
      wireField: "verification_report",
      phase: "verify"
    }
  ];
}
function standardSuperpowersArtifactSlot(relativePath2, slots) {
  const key = comparisonKey(relativePath2);
  const slot = slots.find((candidate) => key.startsWith(comparisonKey(candidate.prefix)));
  if (!slot) return null;
  const fileName = key.slice(comparisonKey(slot.prefix).length);
  if (!fileName || fileName.includes("/") || !fileName.endsWith(".md")) return null;
  return slot;
}
function superpowersArtifactValue(governing, slot) {
  return governing.classic?.[slot.field] ?? null;
}
function allowsFirstSuperpowersArtifactWrite(governing, slot) {
  return governing.classic !== null && governing.phase === slot.phase && !superpowersArtifactValue(governing, slot);
}
function allowsSuperpowersArtifacts(governing) {
  return governing.phase === "design" || governing.phase === "build" || governing.phase === "verify";
}
function governingChangeName(governing) {
  return governing.changeDir ? path29.basename(governing.changeDir) : null;
}
var SUPERPOWERS_ARTIFACT_SUFFIXES = /* @__PURE__ */ new Set([
  "design",
  "plan",
  "verify",
  "verification",
  "verification-report",
  "report"
]);
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
function matchesRecordedSuperpowersArtifact(relativePath2, governing) {
  const artifactPaths = [
    governing.classic?.designDoc,
    governing.classic?.plan,
    governing.classic?.verificationReport
  ];
  return artifactPaths.some(
    (artifactPath) => artifactPath && comparisonKey(artifactPath) === comparisonKey(relativePath2)
  );
}
function matchesSuperpowersArtifactName(relativePath2, changeName) {
  const fileName = relativePath2.split("/").at(-1) ?? relativePath2;
  const stem = fileName.replace(/\.[^.]+$/u, "");
  if (stem === changeName) return true;
  const suffixes = [...SUPERPOWERS_ARTIFACT_SUFFIXES].map(escapeRegex).join("|");
  const pattern = new RegExp(`(^|[-_.])${escapeRegex(changeName)}[-_.](${suffixes})$`, "u");
  return pattern.test(stem);
}
async function superpowersArtifactGoverningChange(relativePath2, projectRoot) {
  const active = await activeChanges(projectRoot);
  const recorded = active.find(
    (governing) => matchesRecordedSuperpowersArtifact(relativePath2, governing)
  );
  if (recorded) return { governing: recorded, match: "recorded" };
  const eligible = active.filter(allowsSuperpowersArtifacts);
  const named = eligible.filter((governing) => {
    const name = governingChangeName(governing);
    return name !== null && matchesSuperpowersArtifactName(relativePath2, name);
  }).sort(
    (a, b) => (governingChangeName(b)?.length ?? 0) - (governingChangeName(a)?.length ?? 0)
  )[0];
  if (named) return { governing: named, match: "named" };
  return null;
}
async function repoSourceGoverningChange(projectRoot, relativePath2, selectedChangeName) {
  const active = await activeChanges(projectRoot);
  if (active.length === 0) return null;
  if (selectedChangeName) {
    const selected = active.find(
      (governing) => governingChangeName(governing) === selectedChangeName
    );
    return selected ?? {
      blockedResult: blockedStaleSelection(
        relativePath2,
        `selected change '${selectedChangeName}' is no longer active`
      )
    };
  }
  const current = await resolveCurrentChange(projectRoot);
  if (current.status === "stale") {
    return { blockedResult: blockedStaleSelection(relativePath2, current.reason) };
  }
  if (current.status === "selected") {
    const selected = active.find(
      (governing) => governingChangeName(governing) === current.selection.change
    );
    if (selected) return selected;
    return {
      blockedResult: blockedStaleSelection(
        relativePath2,
        `selected change '${current.selection.change}' is no longer active`
      )
    };
  }
  if (active.length === 1) {
    const sole = active[0];
    if (sole.changeDir !== null) {
      const outcome = await resolveBranchBinding(sole.changeDir, {
        heal: false,
        cwd: projectRoot
      });
      const name = governingChangeName(sole) ?? "unknown";
      if (outcome.status === "drift") {
        return {
          blockedResult: blockedStaleSelection(
            relativePath2,
            driftStaleReason(name, outcome.boundBranch, outcome.currentBranch)
          )
        };
      }
      if (outcome.status === "unbound-detached") {
        return {
          blockedResult: blockedStaleSelection(relativePath2, unboundDetachedMessage(name))
        };
      }
    }
    return sole;
  }
  return {
    blockedResult: blockedMultipleChanges(
      relativePath2,
      active.map((governing) => governingChangeName(governing)).filter(Boolean)
    )
  };
}
async function governingChange(relativePath2, projectRoot, layout, selectedChangeName) {
  const prefix = `${classicProjectRelative(projectRoot, layout.changesDir)}/`;
  if (relativePath2.startsWith(prefix)) {
    const rest = relativePath2.slice(prefix.length);
    const [name] = rest.split("/");
    if (name && name !== "archive") {
      const active = await inspectClassicActiveChangeDirectory(name, projectRoot);
      if (active.stateExists) {
        const governing = await loadGoverningChange(active.directory);
        if (governing) return governing;
        return { changeDir: active.directory, phase: "open", classic: null, archived: false };
      }
      return { changeDir: active.directory, phase: "open", classic: null, archived: false };
    }
  }
  if (isSuperpowersArtifactPath(relativePath2, superpowersArtifactPrefix(projectRoot, layout))) {
    const superpowers = await superpowersArtifactGoverningChange(relativePath2, projectRoot);
    if (superpowers?.match === "recorded") {
      return { ...superpowers.governing, superpowersArtifact: "matched" };
    }
    const slot = standardSuperpowersArtifactSlot(
      relativePath2,
      superpowersArtifactSlots(projectRoot, layout)
    );
    if (superpowers) {
      return slot ? {
        ...superpowers.governing,
        superpowersArtifact: allowsFirstSuperpowersArtifactWrite(superpowers.governing, slot) ? "matched" : "unmatched",
        superpowersSlot: slot
      } : { ...superpowers.governing, superpowersArtifact: "matched" };
    }
    if (slot) {
      const candidate = await repoSourceGoverningChange(
        projectRoot,
        relativePath2,
        selectedChangeName
      );
      if (!candidate || "blockedResult" in candidate) return candidate;
      return {
        ...candidate,
        superpowersArtifact: allowsFirstSuperpowersArtifactWrite(candidate, slot) ? "matched" : "unmatched",
        superpowersSlot: slot
      };
    }
    const active = await activeChanges(projectRoot);
    const fallback = selectedChangeName ? active.find((candidate) => governingChangeName(candidate) === selectedChangeName) ?? null : active[0] ?? null;
    return fallback ? { ...fallback, superpowersArtifact: "unmatched" } : null;
  }
  return repoSourceGoverningChange(projectRoot, relativePath2, selectedChangeName);
}
function isRootMarkdown(relativePath2) {
  return !relativePath2.includes("/") && relativePath2.endsWith(".md");
}
function isCometConfig(relativePath2) {
  return relativePath2.startsWith(".comet/") || relativePath2.includes("/.comet/");
}
function isSuperpowersWorkspace(relativePath2) {
  return relativePath2 === ".superpowers" || relativePath2.startsWith(".superpowers/");
}
function openSpecAllowed(relativePath2, phase, openSpecPrefix) {
  if (!relativePath2.startsWith(openSpecPrefix)) return null;
  const stateFile2 = relativePath2.endsWith("/.comet.yaml") || relativePath2.endsWith("/.openspec.yaml");
  const proposal = relativePath2.endsWith("/proposal.md") || relativePath2.endsWith("/design.md") || relativePath2.endsWith("/tasks.md");
  const handoff = relativePath2.includes("/.comet/");
  const specs = relativePath2.includes("/specs/");
  if (phase === "open" && (proposal || stateFile2 || handoff || specs)) {
    return `${relativePath2} (phase: open, openspec artifacts)`;
  }
  if (phase === "design" && (proposal || stateFile2 || handoff || specs)) {
    return `${relativePath2} (phase: design, handoff/spec)`;
  }
  if (phase === "build" && (relativePath2.endsWith("/tasks.md") || stateFile2 || specs)) {
    return `${relativePath2} (phase: build, spec/tasks)`;
  }
  if (phase === "verify" && (relativePath2.endsWith("/tasks.md") || stateFile2)) {
    return `${relativePath2} (phase: verify, tasks/state)`;
  }
  if (phase === "archive" && stateFile2) {
    return `${relativePath2} (phase: archive, state)`;
  }
  return null;
}
function blocked(relativePath2, phase) {
  const guidance = phase === "open" ? [
    "  BLOCKED: source writes are not allowed during open",
    "  This phase does not allow source writes",
    "  ALLOWED: create proposal/design/tasks artifacts and run guard",
    "  NEXT: finish clarification and artifacts, then run guard --apply"
  ] : phase === "design" ? [
    "  BLOCKED: source writes are not allowed during design",
    "  This phase does not allow source writes",
    "  ALLOWED: run brainstorming, create the Design Doc, and run guard",
    "  NEXT: finish the Design Doc, then run comet guard <change-name> design --apply to enter build"
  ] : [
    "  BLOCKED: source writes are not allowed during archive",
    "  This phase does not allow source writes",
    "  ALLOWED: confirm archive state and run the archive script"
  ];
  return result(
    2,
    [
      "",
      "╔══════════════════════════════════════════╗",
      "║     COMET PHASE GUARD — WRITE BLOCKED    ║",
      "╚══════════════════════════════════════════╝",
      "",
      `  Current phase: ${phase}`,
      `  Target file: ${relativePath2}`,
      "",
      ...guidance,
      ""
    ].join("\n")
  );
}
function blockedMissingDesignDoc(relativePath2) {
  return result(
    2,
    [
      "",
      "╔══════════════════════════════════════════╗",
      "║     COMET PHASE GUARD — WRITE BLOCKED    ║",
      "╚══════════════════════════════════════════╝",
      "",
      "  Current phase: build (workflow: full), but design_doc is empty",
      `  Target file: ${relativePath2}`,
      "",
      "  BLOCKED: full workflow source writes require a recorded Design Doc",
      "  This phase does not allow source writes until design_doc is recorded",
      "  NEXT: return to design, create/link the Design Doc, then run guard again",
      ""
    ].join("\n")
  );
}
function blockedUnmatchedSuperpowersArtifact(relativePath2, governing) {
  const slot = governing.superpowersSlot;
  const recorded = slot ? superpowersArtifactValue(governing, slot) : null;
  const details = slot ? governing.phase !== slot.phase ? [
    `  BLOCKED: ${slot.wireField} cannot be first-written in phase ${governing.phase}`,
    `  Expected phase: ${slot.phase}`,
    "  NEXT: resume the matching Comet phase or use an already recorded artifact path"
  ] : recorded ? [
    `  BLOCKED: ${slot.wireField} is already recorded for this change`,
    `  Recorded path: ${recorded}`,
    "  NEXT: write the recorded artifact or explicitly correct the state path"
  ] : [
    "  BLOCKED: standard Superpowers artifact state is incomplete",
    "  NEXT: validate the active change state, then retry the matching phase"
  ] : [
    "  BLOCKED: unmatched Superpowers artifact",
    "  This docs/superpowers/ path does not match any active change artifact",
    "  NEXT: use a recorded artifact path or a standard phase artifact directory"
  ];
  return result(
    2,
    [
      "",
      "╔══════════════════════════════════════════╗",
      "║     COMET PHASE GUARD — WRITE BLOCKED    ║",
      "╚══════════════════════════════════════════╝",
      "",
      `  Current phase: ${governing.phase}`,
      `  Target file: ${relativePath2}`,
      "",
      ...details,
      ""
    ].join("\n")
  );
}
function blockedMultipleChanges(relativePath2, changeNames) {
  return result(
    2,
    [
      "",
      "╔══════════════════════════════════════════╗",
      "║     COMET PHASE GUARD — WRITE BLOCKED    ║",
      "╚══════════════════════════════════════════╝",
      "",
      "  BLOCKED: multiple active changes require a current change",
      `  Target file: ${relativePath2}`,
      `  Active changes: ${changeNames.join(", ")}`,
      "",
      "  NEXT: run comet state select <change-name>, then retry the source write",
      ""
    ].join("\n")
  );
}
function blockedStaleSelection(relativePath2, reason) {
  return result(
    2,
    [
      "",
      "╔══════════════════════════════════════════╗",
      "║     COMET PHASE GUARD — WRITE BLOCKED    ║",
      "╚══════════════════════════════════════════╝",
      "",
      "  BLOCKED: current change selection is stale or invalid",
      `  Target file: ${relativePath2}`,
      `  Reason: ${reason}`,
      "",
      "  NEXT: run comet state select <change-name>, then retry the source write",
      ""
    ].join("\n")
  );
}
async function inspectClassicHookTarget(projectRoot, target, selectedChangeName) {
  const relativePath2 = await projectRelative(target, projectRoot);
  let layout;
  try {
    layout = await assertClassicLayoutWritable(projectRoot);
  } catch (error) {
    return result(
      2,
      `[COMET-HOOK] blocked: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (isCometConfig(relativePath2)) {
    return allowed(`${relativePath2} (whitelist: comet config)`);
  }
  if (relativePath2.startsWith(".claude/")) {
    return allowed(`${relativePath2} (whitelist: claude config)`);
  }
  if (isSuperpowersWorkspace(relativePath2)) {
    return allowed(`${relativePath2} (whitelist: superpowers workspace)`);
  }
  if (relativePath2 === "CLAUDE.md" || relativePath2 === "CHANGELOG.md" || relativePath2 === "README.md" || isRootMarkdown(relativePath2)) {
    return allowed(`${relativePath2} (whitelist: root markdown)`);
  }
  let governing;
  try {
    governing = await governingChange(relativePath2, projectRoot, layout, selectedChangeName);
  } catch (error) {
    return result(
      2,
      `[COMET-HOOK] blocked: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!governing) return allowed("no active comet change");
  if ("blockedResult" in governing) return governing.blockedResult;
  if (governing.archived) return allowed(`${relativePath2} (own change archived)`);
  const phase = governing.phase;
  const openSpec = openSpecAllowed(
    relativePath2,
    phase,
    `${classicProjectRelative(projectRoot, layout.openSpecRoot)}/`
  );
  if (openSpec) return allowed(openSpec);
  if (isSuperpowersArtifactPath(relativePath2, superpowersArtifactPrefix(projectRoot, layout))) {
    if (governing.superpowersArtifact === "matched" && allowsSuperpowersArtifacts(governing)) {
      return allowed(`${relativePath2} (phase: ${phase}, superpowers)`);
    }
    if (governing.superpowersArtifact === "unmatched") {
      return blockedUnmatchedSuperpowersArtifact(relativePath2, governing);
    }
  }
  if (phase === "build" && governing.classic?.workflow === "full" && !governing.classic.designDoc) {
    return blockedMissingDesignDoc(relativePath2);
  }
  if (phase === "build" || phase === "verify") {
    return allowed(`${relativePath2} (phase: ${phase})`);
  }
  return blocked(relativePath2, phase);
}
var classicHookGuardCommand = async (args) => {
  const projectRoot = parseProjectRoot(args);
  const target = inputTarget();
  if (!target) return allowed("no file path in tool input");
  return inspectClassicHookTarget(projectRoot, target);
};

// domains/comet-classic/classic-intent.ts
var COMET_INTENT_SCHEMA_VERSION = "comet.intent.v1";
var COMET_INTENT_CONFIDENCE_THRESHOLD = 0.7;
var INTENT_NAMES = [
  "start_change",
  "resume_change",
  "fix_bug",
  "make_tweak",
  "ask_question",
  "unknown"
];
var ENTITY_TYPES = [
  "change_id",
  "workflow",
  "file_path",
  "command",
  "capability",
  "bug_signal",
  "risk_signal"
];
var REQUESTED_ACTIONS = [
  "start",
  "resume",
  "continue",
  "fix",
  "modify",
  "create",
  "verify",
  "archive",
  "question",
  "unknown"
];
var WORKFLOWS = ["full", "hotfix", "tweak"];
var SCOPES = ["small", "medium", "large", "unknown"];
var ROUTES = ["full", "hotfix", "tweak", "resume", "ask_user", "out_of_scope"];
var NEXT_SKILLS = [
  "comet-open",
  "comet-hotfix",
  "comet-tweak",
  "comet-design",
  "comet-build",
  "comet-verify",
  "comet-archive"
];
var EVIDENCE_SOURCES = ["user", "repo", "state"];
var CometIntentValidationError = class extends Error {
  constructor(issues) {
    super(`Invalid CometIntentFrame:
${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.issues = issues;
  }
  issues;
};
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function enumValue2(value, allowed2, field2, issues) {
  if (typeof value !== "string" || !allowed2.includes(value)) {
    issues.push(`${field2} must be one of: ${allowed2.join(", ")}`);
    return null;
  }
  return value;
}
function optionalEnumValue(value, allowed2, field2, issues) {
  if (value === null || value === void 0) return null;
  return enumValue2(value, allowed2, field2, issues);
}
function stringValue(value, field2, issues) {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`${field2} must be a non-empty string`);
    return "";
  }
  return value;
}
function optionalStringValue(value, field2, issues) {
  if (value === null || value === void 0) return null;
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`${field2} must be a non-empty string or null`);
    return null;
  }
  return value;
}
function optionalBooleanValue(value, field2, issues) {
  if (value === null || value === void 0) return null;
  if (typeof value !== "boolean") {
    issues.push(`${field2} must be boolean or null`);
    return null;
  }
  return value;
}
function confidenceValue(value, field2, issues) {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 1) {
    issues.push(`${field2} must be a number between 0 and 1`);
    return 0;
  }
  return value;
}
function nonNegativeIntegerValue(value, field2, issues) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    issues.push(`${field2} must be a non-negative integer`);
    return 0;
  }
  return value;
}
function validateFrame(input) {
  const issues = [];
  if (!isRecord2(input)) throw new CometIntentValidationError(["frame must be an object"]);
  const intent = isRecord2(input.intent) ? input.intent : {};
  if (!isRecord2(input.intent)) issues.push("intent must be an object");
  const slots = isRecord2(input.slots) ? input.slots : {};
  if (!isRecord2(input.slots)) issues.push("slots must be an object");
  const context = isRecord2(input.context) ? input.context : {};
  if (!isRecord2(input.context)) issues.push("context must be an object");
  const proposedRouteInput = isRecord2(input.proposed_route) ? input.proposed_route : {};
  if (!isRecord2(input.proposed_route)) issues.push("proposed_route must be an object");
  const entities = input.entities === void 0 ? [] : Array.isArray(input.entities) ? input.entities : [];
  if (input.entities !== void 0 && !Array.isArray(input.entities)) {
    issues.push("entities must be an array");
  }
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  if (!Array.isArray(input.evidence)) issues.push("evidence must be an array");
  const frame = {
    schema_version: enumValue2(
      input.schema_version,
      [COMET_INTENT_SCHEMA_VERSION],
      "schema_version",
      issues
    ),
    utterance: stringValue(input.utterance, "utterance", issues),
    locale: input.locale === void 0 ? "unknown" : stringValue(input.locale, "locale", issues),
    intent: {
      name: enumValue2(intent.name, INTENT_NAMES, "intent.name", issues) ?? "unknown",
      confidence: confidenceValue(intent.confidence, "intent.confidence", issues)
    },
    entities: entities.map((entity, index) => {
      const record2 = isRecord2(entity) ? entity : {};
      if (!isRecord2(entity)) issues.push(`entities[${index}] must be an object`);
      return {
        type: enumValue2(record2.type, ENTITY_TYPES, `entities[${index}].type`, issues) ?? "risk_signal",
        value: stringValue(record2.value, `entities[${index}].value`, issues),
        text: stringValue(record2.text, `entities[${index}].text`, issues)
      };
    }),
    slots: {
      requested_action: enumValue2(slots.requested_action, REQUESTED_ACTIONS, "slots.requested_action", issues) ?? "unknown",
      workflow_candidate: optionalEnumValue(
        slots.workflow_candidate,
        WORKFLOWS,
        "slots.workflow_candidate",
        issues
      ),
      user_explicit_workflow: optionalEnumValue(
        slots.user_explicit_workflow,
        WORKFLOWS,
        "slots.user_explicit_workflow",
        issues
      ),
      change_id: optionalStringValue(slots.change_id, "slots.change_id", issues),
      target_area: optionalStringValue(slots.target_area, "slots.target_area", issues),
      scope: slots.scope === void 0 ? "unknown" : enumValue2(slots.scope, SCOPES, "slots.scope", issues) ?? "unknown",
      existing_behavior: optionalBooleanValue(
        slots.existing_behavior,
        "slots.existing_behavior",
        issues
      ),
      new_capability: optionalBooleanValue(slots.new_capability, "slots.new_capability", issues),
      public_api_change: optionalBooleanValue(
        slots.public_api_change,
        "slots.public_api_change",
        issues
      ),
      schema_change: optionalBooleanValue(slots.schema_change, "slots.schema_change", issues),
      cross_module_change: optionalBooleanValue(
        slots.cross_module_change,
        "slots.cross_module_change",
        issues
      )
    },
    context: {
      active_changes_count: nonNegativeIntegerValue(
        context.active_changes_count,
        "context.active_changes_count",
        issues
      ),
      active_change_names: isRecord2(context) ? (() => {
        if (!Array.isArray(context.active_change_names)) {
          issues.push("context.active_change_names must be an array");
          return [];
        }
        if (!context.active_change_names.every((value) => typeof value === "string")) {
          issues.push("context.active_change_names must only contain strings");
          return [];
        }
        return context.active_change_names;
      })() : [],
      dirty_worktree: optionalBooleanValue(
        context.dirty_worktree,
        "context.dirty_worktree",
        issues
      )
    },
    evidence: evidence.map((item, index) => {
      const record2 = isRecord2(item) ? item : {};
      if (!isRecord2(item)) issues.push(`evidence[${index}] must be an object`);
      return {
        field: stringValue(record2.field, `evidence[${index}].field`, issues),
        quote: stringValue(record2.quote, `evidence[${index}].quote`, issues),
        source: enumValue2(record2.source, EVIDENCE_SOURCES, `evidence[${index}].source`, issues) ?? "user"
      };
    }),
    proposed_route: {
      name: enumValue2(proposedRouteInput.name, ROUTES, "proposed_route.name", issues) ?? "ask_user",
      next_skill: optionalEnumValue(
        proposedRouteInput.next_skill,
        NEXT_SKILLS,
        "proposed_route.next_skill",
        issues
      ),
      confidence: confidenceValue(
        proposedRouteInput.confidence,
        "proposed_route.confidence",
        issues
      ),
      requires_confirmation: typeof proposedRouteInput.requires_confirmation === "boolean" ? proposedRouteInput.requires_confirmation : true,
      fallback_reason: optionalStringValue(
        proposedRouteInput.fallback_reason,
        "proposed_route.fallback_reason",
        issues
      )
    }
  };
  if (issues.length > 0) throw new CometIntentValidationError(issues);
  return frame;
}
function hasEvidence(frame, field2) {
  return frame.evidence.some((item) => item.field === field2 && item.quote.trim() !== "");
}
function hasRiskSignal(frame) {
  return frame.slots.new_capability === true || frame.slots.public_api_change === true || frame.slots.schema_change === true || frame.slots.cross_module_change === true;
}
function route(name, confidence, fallback_reason = null) {
  const nextSkill = {
    full: "comet-open",
    hotfix: "comet-hotfix",
    tweak: "comet-tweak",
    resume: null,
    ask_user: null,
    out_of_scope: null
  };
  return {
    name,
    next_skill: nextSkill[name],
    confidence,
    requires_confirmation: name === "ask_user" || name === "out_of_scope",
    fallback_reason
  };
}
function askUser(reason) {
  return route("ask_user", 0.5, reason);
}
function workflowRoute(workflow, confidence) {
  return route(workflow, confidence);
}
function resolveCometIntentRoute(input) {
  const frame = validateFrame(input);
  const diagnostics = [];
  const confidence = frame.intent.confidence;
  let resolved;
  if (frame.intent.confidence < COMET_INTENT_CONFIDENCE_THRESHOLD) {
    resolved = askUser(
      `intent confidence ${frame.intent.confidence} is below ${COMET_INTENT_CONFIDENCE_THRESHOLD}`
    );
  } else if ((frame.intent.name === "resume_change" || frame.slots.requested_action === "resume" || frame.slots.requested_action === "continue") && !frame.slots.change_id && frame.context.active_changes_count > 1) {
    resolved = askUser("multiple active changes require an explicit change_id");
  } else if ((frame.intent.name === "resume_change" || frame.slots.requested_action === "resume" || frame.slots.requested_action === "continue") && frame.slots.change_id) {
    resolved = frame.context.active_change_names.includes(frame.slots.change_id) ? route("resume", confidence) : askUser(`change_id '${frame.slots.change_id}' is not in active_change_names`);
  } else if (frame.intent.name === "ask_question" || frame.slots.requested_action === "question") {
    resolved = route(
      "out_of_scope",
      confidence,
      "user asked a question without requesting a Comet workflow"
    );
  } else if (frame.slots.user_explicit_workflow && frame.slots.user_explicit_workflow !== "full" && hasRiskSignal(frame)) {
    resolved = askUser(
      `explicit workflow '${frame.slots.user_explicit_workflow}' conflicts with risk signals`
    );
  } else if (frame.slots.user_explicit_workflow) {
    resolved = workflowRoute(frame.slots.user_explicit_workflow, confidence);
  } else if (hasRiskSignal(frame)) {
    resolved = route("full", confidence);
  } else if (frame.intent.name === "fix_bug" && frame.slots.existing_behavior === true && hasEvidence(frame, "slots.workflow_candidate")) {
    resolved = route("hotfix", confidence);
  } else if (frame.intent.name === "make_tweak" && frame.slots.workflow_candidate === "tweak" && hasEvidence(frame, "slots.workflow_candidate")) {
    resolved = route("tweak", confidence);
  } else if (frame.slots.workflow_candidate && hasEvidence(frame, "slots.workflow_candidate")) {
    resolved = workflowRoute(frame.slots.workflow_candidate, confidence);
  } else {
    resolved = askUser("workflow_candidate evidence is missing or route is ambiguous");
  }
  if (resolved.name !== frame.proposed_route.name) {
    diagnostics.push(
      `agent proposed_route '${frame.proposed_route.name}' normalized to '${resolved.name}'`
    );
  }
  if (resolved.next_skill !== frame.proposed_route.next_skill) {
    diagnostics.push(
      `agent proposed_route next_skill '${frame.proposed_route.next_skill}' normalized to '${resolved.next_skill}'`
    );
  }
  if (resolved.requires_confirmation !== frame.proposed_route.requires_confirmation) {
    diagnostics.push(
      `agent proposed_route requires_confirmation '${frame.proposed_route.requires_confirmation}' normalized to '${resolved.requires_confirmation}'`
    );
  }
  if (resolved.fallback_reason !== frame.proposed_route.fallback_reason) {
    diagnostics.push(
      `agent proposed_route fallback_reason '${frame.proposed_route.fallback_reason}' normalized to '${resolved.fallback_reason}'`
    );
  }
  return {
    route: resolved,
    diagnostics,
    normalizedFrame: { ...frame, route: resolved }
  };
}

// domains/comet-classic/classic-intent-command.ts
function result2(exitCode, stdout, stderr) {
  return {
    exitCode,
    ...stdout === void 0 ? {} : { stdout },
    ...stderr === void 0 ? {} : { stderr }
  };
}
function usage() {
  return result2(
    64,
    void 0,
    "Usage: comet-intent.mjs route <frame-json>\nUsage: comet-intent.mjs route --stdin"
  );
}
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}
var classicIntentCommand = async (args, _options) => {
  const [subcommand, input] = args;
  if (subcommand !== "route") return usage();
  const source = input === "--stdin" ? await readStdin() : input;
  if (!source) return usage();
  try {
    const resolution = resolveCometIntentRoute(JSON.parse(source));
    return result2(0, `${JSON.stringify(resolution, null, 2)}
`);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return result2(1, void 0, `Invalid JSON: ${error.message}`);
    }
    if (error instanceof CometIntentValidationError) {
      return result2(1, void 0, error.message);
    }
    throw error;
  }
};

// domains/comet-classic/classic-resume-probe.ts
import { spawn } from "child_process";
var COMET_RESUME_PROBE_SCHEMA_VERSION = "comet.resume_probe.v1";
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeInput(input) {
  if (!isRecord3(input)) {
    throw new Error("Invalid CometResumeProbeInput: input must be an object");
  }
  if (input.schema_version !== COMET_RESUME_PROBE_SCHEMA_VERSION) {
    throw new Error(
      `Invalid CometResumeProbeInput: schema_version must be ${COMET_RESUME_PROBE_SCHEMA_VERSION}`
    );
  }
  if (typeof input.utterance !== "string") {
    throw new Error("Invalid CometResumeProbeInput: utterance must be a string");
  }
  const context = isRecord3(input.agent_context) ? input.agent_context : {};
  return {
    schema_version: COMET_RESUME_PROBE_SCHEMA_VERSION,
    utterance: input.utterance,
    locale: typeof input.locale === "string" ? input.locale : "unknown",
    agent_context: {
      non_trivial_work: context.non_trivial_work === true,
      already_in_comet_flow: context.already_in_comet_flow === true
    }
  };
}
function result3(action, change, confidence, reason, evidence = []) {
  return {
    schema_version: COMET_RESUME_PROBE_SCHEMA_VERSION,
    action,
    changeName: change?.name ?? null,
    phase: change?.phase ?? null,
    nextCommand: action === "auto_resume" || action === "ask_user" ? change?.nextCommand ?? null : null,
    confidence,
    reason,
    evidence
  };
}
async function readIfExists(projectRoot, filePath, label) {
  if (!await classicProjectTargetExists(projectRoot, filePath, {
    label,
    expected: "file"
  })) {
    return "";
  }
  return readClassicProjectFile(projectRoot, filePath, { label });
}
async function changeSearchText(projectRoot, changeDir, classic) {
  const files = ["proposal.md", "design.md", "tasks.md"];
  const parts = [classic.name, classic.workflow, classic.phase];
  for (const file of files) {
    parts.push(
      await readIfExists(
        projectRoot,
        `${changeDir}/${file}`,
        `Classic change ${classic.name} ${file}`
      )
    );
  }
  return parts.join("\n").toLowerCase();
}
function nextCommandForPhase2(phase) {
  switch (phase) {
    case "open":
      return "/comet-open";
    case "design":
      return "/comet-design";
    case "build":
      return "/comet-build";
    case "verify":
      return "/comet-verify";
    case "archive":
      return "/comet-archive";
    default:
      return null;
  }
}
function diagnosticFromProjection(changeDir, name, projection) {
  const classic = projection.classic;
  const unknownKeys = projection.unknownKeys.filter((key) => key !== "run_id");
  if (!classic) {
    return {
      name,
      valid: false,
      workflow: "unknown",
      phase: "invalid",
      currentStep: null,
      nextCommand: null,
      runtimeMode: "invalid",
      runtimeEval: null,
      evidence: [],
      error: `${changeDir} does not contain valid Comet state`
    };
  }
  if (unknownKeys.length > 0) {
    return {
      name,
      valid: false,
      workflow: classic.workflow,
      phase: classic.phase,
      currentStep: null,
      nextCommand: null,
      runtimeMode: "invalid",
      runtimeEval: null,
      evidence: [],
      error: `unknown field(s): ${unknownKeys.join(", ")}`
    };
  }
  return {
    name,
    valid: true,
    workflow: classic.workflow,
    phase: classic.phase,
    currentStep: null,
    nextCommand: nextCommandForPhase2(classic.phase),
    runtimeMode: "engine-projection",
    runtimeEval: null,
    evidence: []
  };
}
async function hasOpenSpecChangeFiles(projectRoot, changeDir) {
  return await classicProjectTargetExists(projectRoot, `${changeDir}/proposal.md`, {
    label: "Classic proposal",
    expected: "file"
  }) || await classicProjectTargetExists(projectRoot, `${changeDir}/design.md`, {
    label: "Classic design",
    expected: "file"
  }) || await classicProjectTargetExists(projectRoot, `${changeDir}/tasks.md`, {
    label: "Classic tasks",
    expected: "file"
  });
}
async function discoverActiveChanges(projectRoot) {
  const changesDir = (await assertClassicLayoutReadable(projectRoot)).changesDir;
  const changesInspection = await inspectClassicProjectTarget(projectRoot, changesDir, {
    label: "Classic changes directory",
    expected: "directory"
  });
  if (!changesInspection.exists) return [];
  const entries = await readDir(changesDir);
  const changes = [];
  for (const entry2 of entries) {
    if (entry2 === "archive") continue;
    if (openSpecChangeNameError(entry2)) continue;
    const active = await inspectClassicActiveChangeDirectory(entry2, projectRoot);
    if (!active.exists) continue;
    const changeDir = active.directory;
    const hasCometState = active.stateExists;
    if (!hasCometState) {
      if (!await hasOpenSpecChangeFiles(projectRoot, changeDir)) continue;
      const missingStateChange = {
        name: entry2,
        workflow: "unknown",
        phase: "invalid",
        nextCommand: null,
        diagnostic: {
          name: entry2,
          valid: false,
          workflow: "unknown",
          phase: "invalid",
          currentStep: null,
          nextCommand: null,
          runtimeMode: "invalid",
          runtimeEval: null,
          evidence: [],
          error: "missing Comet state"
        },
        buildPause: null,
        hasClassicProjection: false,
        verifyResult: null,
        text: "",
        missingCometState: true
      };
      missingStateChange.text = await changeSearchText(projectRoot, changeDir, missingStateChange);
      changes.push(missingStateChange);
      continue;
    }
    const projection = await readClassicState(changeDir, { migrate: false });
    const classic = projection.classic;
    const diagnostic = diagnosticFromProjection(changeDir, entry2, projection);
    const hasClassicProjection = Boolean(classic);
    const phase = classic?.phase ?? diagnostic.phase;
    const workflow = classic?.workflow ?? diagnostic.workflow;
    if (phase === "archive" || classic?.archived) continue;
    const change = {
      name: entry2,
      workflow,
      phase,
      nextCommand: diagnostic.nextCommand,
      diagnostic,
      buildPause: classic?.buildPause ?? null,
      hasClassicProjection,
      verifyResult: classic?.verifyResult ?? null,
      text: "",
      missingCometState: false
    };
    change.text = await changeSearchText(projectRoot, changeDir, change);
    changes.push(change);
  }
  return changes;
}
var RESUME_WORDS = [
  "continue",
  "resume",
  "carry on",
  "finish",
  "run it",
  "commit",
  "verify",
  "archive",
  "继续",
  "接着",
  "恢复",
  "跑完",
  "提交",
  "验证",
  "归档",
  "修刚才"
];
var QUESTION_WORDS = [
  "what",
  "why",
  "how",
  "explain",
  "summarize",
  "reliable",
  "靠谱吗",
  "是什么",
  "为什么",
  "解释",
  "总结",
  "取名",
  "命名"
];
var GENERIC_RELATED_TOKENS = /* @__PURE__ */ new Set([
  "add",
  "build",
  "cache",
  "change",
  "code",
  "design",
  "docs",
  "file",
  "fix",
  "implement",
  "plan",
  "readme",
  "task",
  "test",
  "update",
  "修改",
  "更新",
  "修复",
  "添加",
  "文档",
  "任务",
  "计划",
  "实现"
]);
var OPT_OUT_WORDS = [
  "do not resume",
  "don't resume",
  "without comet",
  "skip comet",
  "不要恢复",
  "不走 comet",
  "不要走 comet",
  "直接解释",
  "只回答"
];
function includesAny(text2, words) {
  return words.some((word) => text2.includes(word));
}
function hasDecisionPoint(change) {
  if (change.missingCometState) return true;
  if (!change.hasClassicProjection) return true;
  if (!change.diagnostic.valid) return true;
  if (change.phase === "archive") return true;
  if (change.verifyResult === "fail") return true;
  if (change.diagnostic.runtimeEval && !change.diagnostic.runtimeEval.passed) return true;
  if (change.phase !== "build") return false;
  if (change.buildPause === "plan-ready") return true;
  return false;
}
function relatedEvidence(utterance, change) {
  const text2 = utterance.toLowerCase();
  const evidence = [];
  if (text2.includes(change.name.toLowerCase())) {
    evidence.push({ source: "user", quote: change.name });
  }
  const tokens = change.text.split(/[^a-zA-Z0-9_\-\u4e00-\u9fff/]+/u).map((token) => token.trim().toLowerCase()).filter((token) => token.length >= 4 && !GENERIC_RELATED_TOKENS.has(token));
  const matched = [...new Set(tokens.filter((token) => text2.includes(token)))].slice(0, 3);
  for (const token of matched) {
    evidence.push({ source: "repo", quote: token });
  }
  return evidence;
}
async function gitDirtyFiles(projectRoot) {
  return new Promise((resolve) => {
    const child = spawn("git", ["status", "--short", "--untracked-files=all"], {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "ignore"],
      shell: false
    });
    const chunks = [];
    child.stdout.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.on("error", () => resolve([]));
    child.on("exit", (code) => {
      if (code !== 0) {
        resolve([]);
        return;
      }
      const dirtyFiles = Buffer.concat(chunks).toString("utf8").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
      resolve(dirtyFiles);
    });
  });
}
async function resolveCometResumeProbe(projectRoot, rawInput) {
  const input = normalizeInput(rawInput);
  const utterance = input.utterance.trim();
  const lower = utterance.toLowerCase();
  if (input.agent_context.already_in_comet_flow) {
    return result3("out_of_scope", null, "low", "already in Comet flow");
  }
  if (includesAny(lower, OPT_OUT_WORDS)) {
    return result3("out_of_scope", null, "low", "user opted out of Comet resume", [
      { source: "user", quote: utterance }
    ]);
  }
  const changes = await discoverActiveChanges(projectRoot);
  if (changes.length === 0) {
    return result3("none", null, "none", "no active Comet changes");
  }
  const dirtyFiles = await gitDirtyFiles(projectRoot);
  if (changes.length > 1) {
    const named = changes.find((change2) => lower.includes(change2.name.toLowerCase()));
    if (!named) {
      return result3("ask_user", null, "low", "multiple active changes require a change name");
    }
    if (dirtyFiles.length > 0) {
      return result3("ask_user", named, "low", "uncommitted worktree changes require attribution", [
        { source: "repo", quote: `${dirtyFiles.length} dirty file(s)` }
      ]);
    }
    return hasDecisionPoint(named) ? result3("ask_user", named, "low", "active change is at a decision point") : result3("auto_resume", named, "high", "request names an active change", [
      { source: "user", quote: named.name }
    ]);
  }
  const [change] = changes;
  if (dirtyFiles.length > 0) {
    return result3("ask_user", change, "low", "uncommitted worktree changes require attribution", [
      { source: "repo", quote: `${dirtyFiles.length} dirty file(s)` }
    ]);
  }
  if (hasDecisionPoint(change)) {
    if (change.missingCometState) {
      return result3("ask_user", change, "low", "active OpenSpec change is missing Comet state");
    }
    return result3("ask_user", change, "low", "active change is at a decision point", [
      { source: "state", quote: `phase: ${change.phase}` }
    ]);
  }
  const resumeLike = includesAny(lower, RESUME_WORDS);
  const questionLike = !input.agent_context.non_trivial_work && includesAny(lower, QUESTION_WORDS);
  if (questionLike && !resumeLike) {
    return result3("out_of_scope", change, "low", "user asked a question without workflow work");
  }
  const evidence = relatedEvidence(utterance, change);
  if (resumeLike || evidence.length > 0) {
    return result3("auto_resume", change, "high", "single active change and request is related", [
      { source: "state", quote: `phase: ${change.phase}` },
      ...evidence
    ]);
  }
  if (input.agent_context.non_trivial_work) {
    return result3(
      "ask_user",
      change,
      "low",
      "single active change exists but request looks unrelated"
    );
  }
  return result3("out_of_scope", change, "low", "request is not workflow work");
}

// domains/comet-classic/classic-resume-probe-command.ts
function result4(exitCode, stdout, stderr) {
  return {
    exitCode,
    ...stdout === void 0 ? {} : { stdout },
    ...stderr === void 0 ? {} : { stderr }
  };
}
function usage2() {
  return result4(
    64,
    void 0,
    "Usage: comet-resume-probe.mjs probe <input-json>\nUsage: comet-resume-probe.mjs probe --stdin"
  );
}
async function readStdin2() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}
function rawUtteranceInput(utterance) {
  return {
    schema_version: COMET_RESUME_PROBE_SCHEMA_VERSION,
    utterance,
    locale: "unknown",
    agent_context: {
      non_trivial_work: true,
      already_in_comet_flow: false
    }
  };
}
function parseStdinInput(source) {
  try {
    return JSON.parse(source);
  } catch {
    return rawUtteranceInput(source);
  }
}
var classicResumeProbeCommand = async (args, options) => withClassicCommandContext(options, async () => {
  const [subcommand, input] = args;
  if (subcommand !== "probe") return usage2();
  const fromStdin = input === "--stdin";
  const source = fromStdin ? await readStdin2() : input;
  if (!source) return usage2();
  try {
    const parsedInput = fromStdin ? parseStdinInput(source) : JSON.parse(source);
    const resolution = await resolveCometResumeProbe(classicCommandProjectRoot(), parsedInput);
    return result4(0, `${JSON.stringify(resolution, null, 2)}
`);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return result4(1, void 0, `Invalid JSON: ${error.message}`);
    }
    return result4(1, void 0, error instanceof Error ? error.message : String(error));
  }
});

// domains/comet-classic/classic-root-move.ts
init_file_identity();
init_project_config();
init_project_config_reader();
init_protected_project_path();
import { createHash as createHash9, randomUUID as randomUUID8 } from "crypto";
import { promises as fs21 } from "fs";
import path30 from "path";
var JOURNAL_RELATIVE_PATH = ".comet/classic-root-move.json";
var STAGING_PLAN_IDENTITY = ".comet/transactions/classic-root-move/<transaction-id>/openspec";
var HISTORICAL_POINTERS_PRESERVED = [
  "handoff hashes",
  "Run state",
  "checkpoints",
  "trajectory",
  "archived evidence and artifact pointers"
];
var APPLY_PRECONDITIONS = [
  "approved plan ID still matches layout, source identity and manifest, target identity, and configuration",
  "no pending root-move recovery transaction",
  "target remains absent or the bound empty directory",
  "source, target, staging, transaction, and config paths remain protected"
];
var MAX_FILES = 5e4;
var MAX_TOTAL_BYTES = 512 * 1024 * 1024;
var MAX_JOURNAL_BYTES = 16 * 1024 * 1024;
var HASH_PATTERN = /^[a-f0-9]{64}$/u;
var UUID_PATTERN2 = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
var journalClaimBrand = /* @__PURE__ */ Symbol("ClassicRootMoveJournalClaim");
function projectRelative2(projectRoot, target) {
  return path30.relative(projectRoot, target).replaceAll("\\", "/");
}
async function assertProtectedMovePath(projectRoot, target, label, expected = "directory") {
  await inspectProtectedProjectPath(projectRoot, projectRelative2(projectRoot, target), {
    label: `Classic root move physical path ${label}`,
    expected
  });
}
function sameDirectoryObject(expected, actual) {
  return sameFileObject(expected, actual);
}
async function captureProtectedDirectoryChain(projectRoot, directory, label) {
  const root = path30.resolve(projectRoot);
  const target = path30.resolve(directory);
  const relative = path30.relative(root, target);
  if (path30.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path30.sep}`)) {
    throw new Error(`${label} must stay inside the project root`);
  }
  if (target !== root) {
    await assertProtectedMovePath(projectRoot, directory, label, "directory");
  }
  const paths = [root];
  let cursor = root;
  for (const segment of relative.split(path30.sep).filter(Boolean)) {
    cursor = path30.join(cursor, segment);
    paths.push(cursor);
  }
  const entries = [];
  for (const current of paths) {
    const stat = await fs21.lstat(current, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`${label} crosses a symbolic link or junction`);
    }
    entries.push({ path: current, identity: fileObjectIdentity(stat), stat });
  }
  return { entries };
}
async function validateProtectedDirectoryChain(chain, label) {
  for (const entry2 of chain.entries) {
    const stat = await fs21.lstat(entry2.path, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || !sameDirectoryObject(entry2.identity, fileObjectIdentity(stat))) {
      throw new Error(`${label} changed after inspection`);
    }
  }
}
async function readProtectedDirectory(projectRoot, directory, label, testHooks) {
  const chain = await captureProtectedDirectoryChain(projectRoot, directory, label);
  await testHooks?.afterDirectoryInspect?.(label);
  await validateProtectedDirectoryChain(chain, label);
  const entries = await fs21.readdir(directory, { withFileTypes: true });
  await validateProtectedDirectoryChain(chain, label);
  return entries;
}
async function protectedDirectoryExists(projectRoot, directory, label) {
  try {
    await captureProtectedDirectoryChain(projectRoot, directory, label);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function ensureRootMoveDirectory(projectRoot, directory, label, testHooks) {
  const root = path30.resolve(projectRoot);
  const target = path30.resolve(directory);
  const relative = path30.relative(root, target);
  if (path30.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path30.sep}`)) {
    throw new Error(`${label} must stay inside the project root`);
  }
  let cursor = root;
  for (const segment of relative.split(path30.sep).filter(Boolean)) {
    const next2 = path30.join(cursor, segment);
    try {
      const stat = await fs21.lstat(next2, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(`${label} crosses a symbolic link or junction`);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const chain = await captureProtectedDirectoryChain(projectRoot, cursor, label);
      const operation = `create-directory:${projectRelative2(projectRoot, next2)}`;
      await testHooks?.beforeMutation?.(operation);
      await validateProtectedDirectoryChain(chain, label);
      try {
        await fs21.mkdir(next2);
      } catch (mkdirError) {
        if (mkdirError.code !== "EEXIST") throw mkdirError;
      }
      await validateProtectedDirectoryChain(chain, label);
      const created = await fs21.lstat(next2, { bigint: true });
      if (!created.isDirectory() || created.isSymbolicLink()) {
        throw new Error(`${label} changed while creating a directory`, { cause: error });
      }
    }
    cursor = next2;
  }
  await assertProtectedMovePath(projectRoot, directory, label, "directory");
}
async function captureMutationObject(target, expected, label) {
  const stat = await fs21.lstat(target, { bigint: true });
  if (stat.isSymbolicLink() || (expected === "file" ? !stat.isFile() : !stat.isDirectory())) {
    throw new Error(`${label} must be a real ${expected}`);
  }
  return stat;
}
async function validateMutationObject(target, expected, label) {
  const actual = await fs21.lstat(target, { bigint: true });
  const sameIdentity = expected.isDirectory() ? sameDirectoryObject(fileObjectIdentity(expected), fileObjectIdentity(actual)) : sameInspectedFile(expected, actual);
  if (actual.isSymbolicLink() || actual.isFile() !== expected.isFile() || actual.isDirectory() !== expected.isDirectory() || !sameIdentity) {
    throw new Error(`${label} changed after inspection`);
  }
}
async function writeProtectedFileExclusive(projectRoot, file, bytes, operation, testHooks) {
  const label = `Classic root move ${operation}`;
  const chain = await captureProtectedDirectoryChain(projectRoot, path30.dirname(file), label);
  await testHooks?.beforeMutation?.(operation);
  await validateProtectedDirectoryChain(chain, label);
  const handle = await fs21.open(file, "wx");
  try {
    await validateProtectedDirectoryChain(chain, label);
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await validateProtectedDirectoryChain(chain, label);
  await assertProtectedMovePath(projectRoot, file, label, "file");
}
async function linkProtectedFileExclusive(projectRoot, source, target, operation, testHooks) {
  const label = `Classic root move ${operation}`;
  const sourceParent = await captureProtectedDirectoryChain(
    projectRoot,
    path30.dirname(source),
    label
  );
  const targetParent = await captureProtectedDirectoryChain(
    projectRoot,
    path30.dirname(target),
    label
  );
  const sourceIdentity = await captureMutationObject(source, "file", label);
  await testHooks?.beforeMutation?.(operation);
  await validateProtectedDirectoryChain(sourceParent, label);
  await validateProtectedDirectoryChain(targetParent, label);
  await validateMutationObject(source, sourceIdentity, label);
  await fs21.link(source, target);
  await validateProtectedDirectoryChain(sourceParent, label);
  await validateProtectedDirectoryChain(targetParent, label);
  await validateMutationObject(target, sourceIdentity, label);
}
async function renameProtectedPath(projectRoot, source, target, operation, testHooks, options = {}) {
  const label = `Classic root move ${operation}`;
  const sourceParent = await captureProtectedDirectoryChain(
    projectRoot,
    path30.dirname(source),
    label
  );
  const targetParent = await captureProtectedDirectoryChain(
    projectRoot,
    path30.dirname(target),
    label
  );
  const sourceIdentity = await captureMutationObject(
    source,
    (await fs21.lstat(source)).isDirectory() ? "directory" : "file",
    label
  );
  if (!options.replaceTarget) {
    const inspection = await inspectProtectedProjectPath(
      projectRoot,
      projectRelative2(projectRoot, target),
      { label, expected: "any" }
    );
    if (inspection.exists) throw new Error(`${label} target already exists`);
  } else if (options.expectedTargetIdentity) {
    await validateMutationObject(target, options.expectedTargetIdentity, label);
  }
  await testHooks?.beforeMutation?.(operation);
  await validateProtectedDirectoryChain(sourceParent, label);
  await validateProtectedDirectoryChain(targetParent, label);
  await validateMutationObject(source, sourceIdentity, label);
  if (options.expectedTargetIdentity) {
    await validateMutationObject(target, options.expectedTargetIdentity, label);
  }
  await options.validateTarget?.();
  await fs21.rename(source, target);
  await validateProtectedDirectoryChain(sourceParent, label);
  await validateProtectedDirectoryChain(targetParent, label);
  await validateMutationObject(target, sourceIdentity, label);
}
async function unlinkProtectedFile(projectRoot, file, operation, testHooks, options = {}) {
  const label = `Classic root move ${operation}`;
  let identity;
  try {
    identity = await captureMutationObject(file, "file", label);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  if (options.expectedIdentity) {
    await validateMutationObject(file, options.expectedIdentity, label);
  }
  const parent = await captureProtectedDirectoryChain(projectRoot, path30.dirname(file), label);
  await testHooks?.beforeMutation?.(operation);
  await validateProtectedDirectoryChain(parent, label);
  await validateMutationObject(file, identity, label);
  if (options.expectedIdentity) {
    await validateMutationObject(file, options.expectedIdentity, label);
  }
  await options.validateTarget?.();
  await fs21.unlink(file);
  await validateProtectedDirectoryChain(parent, label);
  return true;
}
async function removeProtectedEmptyDirectory(projectRoot, directory, operation, testHooks, expectedIdentity) {
  const label = `Classic root move ${operation}`;
  let identity;
  try {
    identity = await captureMutationObject(directory, "directory", label);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  if (expectedIdentity && !sameStableIdentity(
    stableObjectIdentity(identity, `Classic root move ${operation}`),
    expectedIdentity
  )) {
    throw new Error(`Classic root move ${operation} changed after migration preflight`);
  }
  const parent = await captureProtectedDirectoryChain(projectRoot, path30.dirname(directory), label);
  await testHooks?.beforeMutation?.(operation);
  await validateProtectedDirectoryChain(parent, label);
  await validateMutationObject(directory, identity, label);
  const entries = await fs21.readdir(directory);
  await validateProtectedDirectoryChain(parent, label);
  await validateMutationObject(directory, identity, label);
  if (entries.length > 0) throw new Error(`${label} directory is not empty`);
  await fs21.rmdir(directory);
  await validateProtectedDirectoryChain(parent, label);
  return true;
}
async function assertRootMovePreflightBoundaries(projectRoot, transactionId) {
  const legacy = classicLayoutPaths(projectRoot, "legacy");
  const docs = classicLayoutPaths(projectRoot, "docs");
  const transactionBase = path30.join(projectRoot, ".comet", "transactions", "classic-root-move");
  const checks = [
    [path30.join(projectRoot, ".comet"), ".comet", "directory"],
    [path30.join(projectRoot, ".comet", "config.yaml"), ".comet/config.yaml", "file"],
    [legacy.openSpecRoot, "openspec", "directory"],
    [path30.dirname(docs.openSpecRoot), "docs", "directory"],
    [docs.openSpecRoot, "docs/openspec", "directory"],
    [path30.join(projectRoot, ".comet", "transactions"), ".comet/transactions", "directory"],
    [transactionBase, ".comet/transactions/classic-root-move", "directory"]
  ];
  if (transactionId) {
    const transactionRoot = path30.join(transactionBase, transactionId);
    checks.push(
      [transactionRoot, `transaction ${transactionId}`, "directory"],
      [path30.join(transactionRoot, "openspec"), `transaction ${transactionId} staging`, "directory"],
      [
        path30.join(transactionRoot, "legacy-source"),
        `transaction ${transactionId} quarantine`,
        "directory"
      ]
    );
  }
  for (const [target, label, expected] of checks) {
    await assertProtectedMovePath(projectRoot, target, label, expected);
  }
}
async function atomicWriteJournal(projectRoot, expected, updated, testHooks) {
  const file = journalFile(projectRoot);
  await ensureRootMoveDirectory(
    projectRoot,
    path30.dirname(file),
    "Classic root move journal parent",
    testHooks
  );
  const temporary = `${file}.${randomUUID8()}.tmp`;
  const serialized = JSON.stringify(updated, null, 2) + "\n";
  let quarantine;
  try {
    await writeProtectedFileExclusive(
      projectRoot,
      temporary,
      serialized,
      "update-journal-temp",
      testHooks
    );
    const temporaryIdentity = await captureMutationObject(
      temporary,
      "file",
      "Classic root move updated journal"
    );
    quarantine = await quarantineOwnedJournal(
      projectRoot,
      expected,
      "update-journal-commit",
      testHooks
    );
    try {
      await linkProtectedFileExclusive(
        projectRoot,
        temporary,
        file,
        "update-journal-publish",
        testHooks
      );
    } catch (error) {
      throw new Error(
        "Classic root move journal publish failed; a successor journal was preserved",
        { cause: error }
      );
    }
    const persisted = await readJournal(projectRoot);
    const persistedClaim = persisted ? journalClaim(persisted) : null;
    if (!persisted || persisted.id !== updated.id || persisted.stage !== updated.stage || persisted.planId !== updated.planId || persisted.schema !== updated.schema || !persistedClaim || persistedClaim.contentHash !== hashBytes(Buffer.from(serialized)) || !sameInspectedFile(temporaryIdentity, persistedClaim.fileIdentity)) {
      throw new Error("Classic root move journal ownership changed while updating");
    }
    await unlinkProtectedFile(
      projectRoot,
      quarantine.file,
      "cleanup-update-journal-quarantine",
      testHooks,
      { expectedIdentity: journalClaim(quarantine.journal).fileIdentity }
    );
    quarantine = void 0;
    return persisted;
  } catch (error) {
    if (quarantine) {
      await restoreQuarantinedJournal(
        projectRoot,
        quarantine,
        "restore-update-journal",
        testHooks
      ).catch(() => false);
    }
    throw error;
  } finally {
    await unlinkProtectedFile(projectRoot, temporary, "cleanup-update-journal-temp").catch(
      () => false
    );
  }
}
async function createJsonExclusive(projectRoot, file, value, testHooks) {
  await ensureRootMoveDirectory(
    projectRoot,
    path30.dirname(file),
    "Classic root move journal parent",
    testHooks
  );
  const temporary = `${file}.${randomUUID8()}.tmp`;
  try {
    await writeProtectedFileExclusive(
      projectRoot,
      temporary,
      JSON.stringify(value, null, 2) + "\n",
      "create-journal-temp",
      testHooks
    );
    await linkProtectedFileExclusive(
      projectRoot,
      temporary,
      file,
      "create-journal-commit",
      testHooks
    );
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(
        "Classic root move is incomplete; use comet doctor --repair --strategy continue|rollback",
        { cause: error }
      );
    }
    throw error;
  } finally {
    await unlinkProtectedFile(projectRoot, temporary, "cleanup-create-journal-temp").catch(
      () => false
    );
  }
}
function manifestHash(manifest) {
  return createHash9("sha256").update(
    JSON.stringify({
      directories: manifest.directories,
      files: manifest.files,
      totalBytes: manifest.totalBytes
    })
  ).digest("hex");
}
function compareManifestPath(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function manifestPathsAreSorted(values, compare) {
  return values.every((entry2, index) => index === 0 || compare(values[index - 1], entry2) <= 0);
}
function planIdFor(plan) {
  return createHash9("sha256").update(
    JSON.stringify({
      source: plan.source,
      target: plan.target,
      staging: plan.staging,
      artifactLayout: plan.artifactLayout,
      sourceIdentity: plan.sourceIdentity,
      targetInitialIdentity: plan.targetInitialIdentity,
      targetInitialState: plan.targetInitialState,
      fileCount: plan.fileCount,
      directoryCount: plan.directoryCount,
      totalBytes: plan.totalBytes,
      manifestHash: plan.manifestHash,
      configPath: plan.configPath,
      originalConfigHash: plan.originalConfigHash,
      expectedConfigHash: plan.expectedConfigHash
    })
  ).digest("hex");
}
function v1PlanIdFor(plan) {
  return createHash9("sha256").update(
    JSON.stringify({
      source: plan.source,
      target: plan.target,
      staging: STAGING_PLAN_IDENTITY,
      targetInitialState: plan.targetInitialState,
      fileCount: plan.fileCount,
      directoryCount: plan.directoryCount,
      totalBytes: plan.totalBytes,
      manifestHash: plan.manifestHash,
      configPath: plan.configPath,
      originalConfigHash: plan.originalConfigHash,
      expectedConfigHash: plan.expectedConfigHash
    })
  ).digest("hex");
}
function birthtimeOf2(stat) {
  return "birthtimeNs" in stat && typeof stat.birthtimeNs === "bigint" ? stat.birthtimeNs : stat.birthtimeMs;
}
function ctimeOf2(stat) {
  return "ctimeNs" in stat && typeof stat.ctimeNs === "bigint" ? stat.ctimeNs : stat.ctimeMs;
}
function mtimeOf(stat) {
  return "mtimeNs" in stat && typeof stat.mtimeNs === "bigint" ? stat.mtimeNs : stat.mtimeMs;
}
function fileObjectIdentity(stat) {
  return { dev: stat.dev, ino: stat.ino, birthtime: birthtimeOf2(stat) };
}
function identityScalar(value) {
  return String(value);
}
function stableObjectIdentity(stat, label) {
  const objectIdentity = fileObjectIdentity(stat);
  if (!hasComparableFileObject(objectIdentity, objectIdentity)) {
    throw new Error(
      `${label} filesystem does not expose a stable device and file identity; refusing an auditable root move`
    );
  }
  return {
    dev: identityScalar(stat.dev),
    ino: identityScalar(stat.ino),
    birthtime: identityScalar(birthtimeOf2(stat)),
    ctime: identityScalar(ctimeOf2(stat)),
    mtime: identityScalar(mtimeOf(stat))
  };
}
function stableChainIdentity(projectRoot, chain, label) {
  return chain.entries.map((entry2) => {
    const identity = stableObjectIdentity(entry2.stat, label);
    return {
      path: projectRelative2(projectRoot, entry2.path) || ".",
      dev: identity.dev,
      ino: identity.ino,
      birthtime: identity.birthtime
    };
  });
}
function sameStableIdentity(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function sameStableChain(left, right) {
  return left.length === right.length && left.every((entry2, index) => sameStableIdentity(entry2, right[index]));
}
async function captureStableSourceIdentity(projectRoot, directory, label) {
  const chain = await captureProtectedDirectoryChain(projectRoot, directory, label);
  await validateProtectedDirectoryChain(chain, label);
  return stableChainIdentity(projectRoot, chain, label);
}
function sameInspectedFile(left, right) {
  const leftObject = fileObjectIdentity(left);
  const rightObject = fileObjectIdentity(right);
  if (hasComparableFileObject(leftObject, rightObject)) {
    return sameFileObject(leftObject, rightObject);
  }
  return sameFileObject(leftObject, rightObject) && birthtimeOf2(left) === birthtimeOf2(right) && ctimeOf2(left) === ctimeOf2(right) && left.size === right.size;
}
function hashBytes(bytes) {
  return createHash9("sha256").update(bytes).digest("hex");
}
async function readRootMoveFile(projectRoot, file, maxBytes, label, inspected) {
  const result5 = await readProtectedProjectFile(
    projectRoot,
    projectRelative2(projectRoot, file),
    maxBytes,
    { label, bigint: true }
  );
  if (inspected && !sameInspectedFile(inspected, result5.stat)) {
    throw new Error(`${label} changed while reading`);
  }
  if (BigInt(result5.stat.size) !== BigInt(result5.bytes.byteLength)) {
    throw new Error(`${label} changed while reading`);
  }
  return result5.bytes;
}
async function projectConfigSnapshot(projectRoot) {
  const snapshot = await readWorkflowProjectConfigSnapshot(projectRoot, {
    allowPartialProject: true
  });
  if (!snapshot.document || !snapshot.identity.exists || !snapshot.identity.sha256) {
    throw new Error(".comet/config.yaml does not exist");
  }
  return snapshot;
}
async function projectConfigHash(projectRoot) {
  return (await projectConfigSnapshot(projectRoot)).identity.sha256;
}
function expectedPostSwitchConfigHash(parsed) {
  const classic = parsed.value.classic;
  if (!classic || typeof classic !== "object" || Array.isArray(classic)) {
    throw new Error("classic must be a mapping");
  }
  const expected = renderStructuredProjectConfig(
    {
      ...parsed.value,
      classic: {
        ...classic,
        artifact_layout: "docs"
      }
    },
    parsed.classic?.language === "zh-CN" || parsed.native?.language === "zh-CN" ? "zh-CN" : "en"
  );
  return createHash9("sha256").update(expected).digest("hex");
}
async function scanTree(projectRoot, root, testHooks) {
  const directories = [];
  const files = [];
  let totalBytes = 0;
  async function visit(directory, relativeDirectory) {
    await assertProtectedMovePath(
      projectRoot,
      directory,
      relativeDirectory || projectRelative2(projectRoot, root),
      "directory"
    );
    const entries = await readProtectedDirectory(
      projectRoot,
      directory,
      `tree:${relativeDirectory || projectRelative2(projectRoot, root)}`,
      testHooks
    );
    for (const entry2 of entries.sort((left, right) => compareManifestPath(left.name, right.name))) {
      const absolute = path30.join(directory, entry2.name);
      const relative = relativeDirectory ? `${relativeDirectory}/${entry2.name}` : entry2.name;
      const stat = await fs21.lstat(absolute, { bigint: true });
      if (stat.isSymbolicLink()) {
        throw new Error(
          `Classic root move does not support symbolic links or junctions: ${relative}`
        );
      }
      if (stat.isDirectory()) {
        directories.push(relative);
        await visit(absolute, relative);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(
          `Classic root move supports only regular files and directories: ${relative}`
        );
      }
      await testHooks?.afterSourceFileInspect?.(relative);
      if (files.length + 1 > MAX_FILES) {
        throw new Error(`Classic root move exceeds ${MAX_FILES} files`);
      }
      const remainingBytes = MAX_TOTAL_BYTES - totalBytes;
      const bytes = await readRootMoveFile(
        projectRoot,
        absolute,
        Math.max(1, remainingBytes),
        `Classic root move source file ${relative}`,
        stat
      );
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error(`Classic root move exceeds ${MAX_TOTAL_BYTES} bytes`);
      }
      files.push({ path: relative, size: bytes.byteLength, hash: hashBytes(bytes) });
    }
  }
  await visit(root, "");
  directories.sort(compareManifestPath);
  files.sort((left, right) => compareManifestPath(left.path, right.path));
  const normalized2 = { directories, files, totalBytes };
  return { ...normalized2, hash: manifestHash(normalized2) };
}
function sameManifest(actual, expected) {
  return actual.hash === expected.hash;
}
async function inspectInitialTarget(projectRoot, target, testHooks) {
  try {
    const chain = await captureProtectedDirectoryChain(projectRoot, target, "docs-target");
    const initialEntry = chain.entries.at(-1);
    if (!initialEntry) throw new Error("Classic docs target identity is unavailable");
    const initialIdentity = stableObjectIdentity(initialEntry.stat, "Classic docs target");
    await testHooks?.afterDirectoryInspect?.("docs-target");
    await validateProtectedDirectoryChain(chain, "docs-target");
    const entries = await fs21.readdir(target, { withFileTypes: true });
    await validateProtectedDirectoryChain(chain, "docs-target");
    const currentChain = await captureProtectedDirectoryChain(projectRoot, target, "docs-target");
    const currentEntry = currentChain.entries.at(-1);
    const currentIdentity = currentEntry ? stableObjectIdentity(currentEntry.stat, "Classic docs target") : null;
    if (!currentIdentity || !sameStableIdentity(initialIdentity, currentIdentity)) {
      throw new Error("Classic docs target changed after inspection");
    }
    if (entries.length > 0) {
      return {
        state: "non-empty",
        conflicts: ["Classic docs target is not empty"],
        identity: currentIdentity
      };
    }
    return { state: "empty", conflicts: [], identity: currentIdentity };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { state: "missing", conflicts: [], identity: null };
    }
    throw error;
  }
}
async function validatedLegacyConfig(projectRoot) {
  await assertClassicWorkflowEnabled(projectRoot);
  if (await readClassicArtifactLayout(projectRoot) !== "legacy") {
    throw new Error("Classic root move requires classic.artifact_layout: legacy");
  }
}
async function preflight2(projectRoot, options = {}) {
  await assertRootMovePreflightBoundaries(projectRoot);
  await validatedLegacyConfig(projectRoot);
  if (await readClassicArtifactLayout(projectRoot) !== "legacy") {
    throw new Error("Classic root move requires the legacy layout");
  }
  const legacy = classicLayoutPaths(projectRoot, "legacy");
  const docs = classicLayoutPaths(projectRoot, "docs");
  if (!await protectedDirectoryExists(projectRoot, legacy.openSpecRoot, "Classic legacy root")) {
    throw new Error("Classic legacy root does not exist: openspec/");
  }
  const sourceIdentityBefore = await captureStableSourceIdentity(
    projectRoot,
    legacy.openSpecRoot,
    "Classic legacy root identity"
  );
  const manifest = await scanTree(projectRoot, legacy.openSpecRoot, options.testHooks);
  const sourceIdentityAfter = await captureStableSourceIdentity(
    projectRoot,
    legacy.openSpecRoot,
    "Classic legacy root identity"
  );
  if (!sameStableChain(sourceIdentityBefore, sourceIdentityAfter)) {
    throw new Error("Classic legacy root identity changed during migration preflight");
  }
  const targetInspection = await inspectInitialTarget(
    projectRoot,
    docs.openSpecRoot,
    options.testHooks
  );
  const configSnapshot = await projectConfigSnapshot(projectRoot);
  await options.testHooks?.afterConfigSnapshot?.();
  const configHash = configSnapshot.identity.sha256;
  const expectedConfigHash = expectedPostSwitchConfigHash(configSnapshot.document);
  const identity = {
    source: projectRelative2(projectRoot, legacy.openSpecRoot),
    target: projectRelative2(projectRoot, docs.openSpecRoot),
    staging: STAGING_PLAN_IDENTITY,
    artifactLayout: "legacy",
    sourceIdentity: sourceIdentityAfter,
    targetInitialIdentity: targetInspection.identity,
    targetInitialState: targetInspection.state,
    fileCount: manifest.files.length,
    directoryCount: manifest.directories.length,
    totalBytes: manifest.totalBytes,
    manifestHash: manifest.hash,
    configPath: WORKFLOW_PROJECT_CONFIG_PATH,
    originalConfigHash: configHash,
    expectedConfigHash
  };
  return {
    manifest,
    plan: {
      projectRoot,
      ...identity,
      configHash,
      planId: planIdFor(identity),
      fileSummary: manifest.files.map((file) => ({ ...file })),
      configChange: { from: "legacy", to: "docs" },
      conflicts: targetInspection.conflicts,
      blockers: [],
      pendingRecovery: null,
      historicalPointersPreserved: [...HISTORICAL_POINTERS_PRESERVED],
      applyPreconditions: [...APPLY_PRECONDITIONS],
      allowedRecoveryStrategies: [],
      readyToApply: targetInspection.conflicts.length === 0
    }
  };
}
async function copyManifest(projectRoot, sourceRoot, targetRoot, manifest, testHooks) {
  await ensureRootMoveDirectory(
    projectRoot,
    targetRoot,
    "Classic root move staging root",
    testHooks
  );
  for (const directory of manifest.directories) {
    await ensureRootMoveDirectory(
      projectRoot,
      path30.join(targetRoot, ...directory.split("/")),
      `Classic root move staging directory ${directory}`,
      testHooks
    );
  }
  for (const file of manifest.files) {
    await testHooks?.beforeSourceFileCopy?.(file.path);
    const source = path30.join(sourceRoot, ...file.path.split("/"));
    const sourceBytes = await readRootMoveFile(
      projectRoot,
      source,
      Math.max(1, file.size),
      `Classic root move source file ${file.path}`
    );
    if (sourceBytes.byteLength !== file.size || hashBytes(sourceBytes) !== file.hash) {
      throw new Error("Classic legacy root changed after migration preflight");
    }
    const target = path30.join(targetRoot, ...file.path.split("/"));
    await ensureRootMoveDirectory(
      projectRoot,
      path30.dirname(target),
      `Classic root move staging parent ${file.path}`,
      testHooks
    );
    const targetInspection = await inspectProtectedProjectPath(
      projectRoot,
      projectRelative2(projectRoot, target),
      { label: `Classic root move staging file ${file.path}`, expected: "file" }
    );
    if (targetInspection.exists) {
      throw new Error("Classic root move staging changed after migration preflight");
    }
    await writeProtectedFileExclusive(
      projectRoot,
      target,
      sourceBytes,
      `copy-file:${file.path}`,
      testHooks
    );
    const copiedBytes = await readRootMoveFile(
      projectRoot,
      target,
      Math.max(1, file.size),
      `Classic root move staging file ${file.path}`
    );
    if (copiedBytes.byteLength !== file.size || hashBytes(copiedBytes) !== file.hash) {
      throw new Error("Classic root move staging verification failed");
    }
  }
}
function journalFile(projectRoot) {
  return path30.join(projectRoot, ...JOURNAL_RELATIVE_PATH.split("/"));
}
function invalidJournal(detail) {
  return new Error(`invalid Classic root move journal: ${detail}`);
}
function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidJournal(`${label} must be an object`);
  }
  return value;
}
function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    throw invalidJournal(`${label} fields are invalid`);
  }
}
function assertSafeManifestPath(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\")) {
    throw invalidJournal(`${label} is invalid`);
  }
  const segments = value.split("/");
  if (path30.posix.isAbsolute(value) || segments.some((segment) => segment === "" || segment === "." || segment === "..") || path30.posix.normalize(value) !== value) {
    throw invalidJournal(`${label} must stay inside the migration tree`);
  }
  return value;
}
function parseManifest(value) {
  const manifest = record(value, "manifest");
  assertExactKeys(manifest, ["directories", "files", "totalBytes", "hash"], "manifest");
  if (!Array.isArray(manifest.directories) || !Array.isArray(manifest.files) || !Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes < 0 || manifest.totalBytes > MAX_TOTAL_BYTES || typeof manifest.hash !== "string" || !HASH_PATTERN.test(manifest.hash)) {
    throw invalidJournal("manifest shape is invalid");
  }
  const directories = manifest.directories.map(
    (entry2, index) => assertSafeManifestPath(entry2, `manifest path directories[${index}]`)
  );
  const files = manifest.files.map((entry2, index) => {
    const file = record(entry2, `manifest.files[${index}]`);
    assertExactKeys(file, ["path", "size", "hash"], `manifest.files[${index}]`);
    const filePath = assertSafeManifestPath(file.path, `manifest path files[${index}]`);
    if (!Number.isSafeInteger(file.size) || file.size < 0 || typeof file.hash !== "string" || !HASH_PATTERN.test(file.hash)) {
      throw invalidJournal(`manifest.files[${index}] is invalid`);
    }
    return { path: filePath, size: file.size, hash: file.hash };
  });
  if (files.length > MAX_FILES) throw invalidJournal(`manifest exceeds ${MAX_FILES} files`);
  const filePaths = files.map((file) => file.path);
  const duplicatePaths = new Set(directories).size !== directories.length || new Set(filePaths).size !== filePaths.length;
  const pathsUseSupportedOrder = manifestPathsAreSorted(directories, compareManifestPath) && manifestPathsAreSorted(filePaths, compareManifestPath) || manifestPathsAreSorted(directories, (left, right) => left.localeCompare(right)) && manifestPathsAreSorted(filePaths, (left, right) => left.localeCompare(right));
  if (duplicatePaths || !pathsUseSupportedOrder) {
    throw invalidJournal("manifest paths must be unique and sorted");
  }
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes !== manifest.totalBytes) {
    throw invalidJournal("manifest totalBytes does not match its files");
  }
  const normalized2 = { directories, files, totalBytes };
  const hash = manifestHash(normalized2);
  if (hash !== manifest.hash) throw invalidJournal("manifest hash is invalid");
  return { ...normalized2, hash };
}
function parseFileObjectIdentity(value, label) {
  const identity = record(value, label);
  assertExactKeys(identity, ["dev", "ino", "birthtime"], label);
  const scalarPattern = /^-?[0-9]+$/u;
  for (const field2 of ["dev", "ino", "birthtime"]) {
    if (typeof identity[field2] !== "string" || !scalarPattern.test(identity[field2])) {
      throw invalidJournal(`${label}.${field2} is invalid`);
    }
  }
  if (identity.dev === "0" || identity.ino === "0") {
    throw invalidJournal(`${label} does not contain a stable filesystem identity`);
  }
  return {
    dev: identity.dev,
    ino: identity.ino,
    birthtime: identity.birthtime
  };
}
function parseObjectIdentity(value, label) {
  const identity = record(value, label);
  assertExactKeys(identity, ["dev", "ino", "birthtime", "ctime", "mtime"], label);
  const base = parseFileObjectIdentity(
    {
      dev: identity.dev,
      ino: identity.ino,
      birthtime: identity.birthtime
    },
    label
  );
  const scalarPattern = /^-?[0-9]+$/u;
  if (typeof identity.ctime !== "string" || !scalarPattern.test(identity.ctime) || typeof identity.mtime !== "string" || !scalarPattern.test(identity.mtime)) {
    throw invalidJournal(`${label} timestamps are invalid`);
  }
  return {
    ...base,
    ctime: identity.ctime,
    mtime: identity.mtime
  };
}
function parseSourceIdentity(value) {
  if (!Array.isArray(value) || value.length !== 2) {
    throw invalidJournal("sourceIdentity must bind the project root and openspec root");
  }
  const expectedPaths = [".", "openspec"];
  return value.map((entry2, index) => {
    const identity = record(entry2, `sourceIdentity[${index}]`);
    assertExactKeys(identity, ["path", "dev", "ino", "birthtime"], `sourceIdentity[${index}]`);
    if (identity.path !== expectedPaths[index]) {
      throw invalidJournal(`sourceIdentity[${index}].path is invalid`);
    }
    const objectIdentity = {
      dev: identity.dev,
      ino: identity.ino,
      birthtime: identity.birthtime
    };
    return {
      path: expectedPaths[index],
      ...parseFileObjectIdentity(objectIdentity, `sourceIdentity[${index}]`)
    };
  });
}
function parseJournalV1(journal) {
  assertExactKeys(
    journal,
    [
      "schema",
      "id",
      "stage",
      "source",
      "target",
      "staging",
      "configPath",
      "originalConfigHash",
      "expectedConfigHash",
      "planId",
      "targetInitialState",
      "manifest"
    ],
    "root"
  );
  if (typeof journal.id !== "string" || !UUID_PATTERN2.test(journal.id)) {
    throw invalidJournal("id is invalid");
  }
  if (journal.stage !== "copying" && journal.stage !== "ready" && journal.stage !== "switched" && journal.stage !== "configured") {
    throw invalidJournal("stage is invalid");
  }
  const expectedStaging = `.comet/transactions/classic-root-move/${journal.id}/openspec`;
  if (journal.source !== "openspec" || journal.target !== "docs/openspec" || journal.staging !== expectedStaging) {
    throw invalidJournal("source, target, and staging must use the managed project paths");
  }
  if (journal.configPath !== WORKFLOW_PROJECT_CONFIG_PATH || typeof journal.originalConfigHash !== "string" || !HASH_PATTERN.test(journal.originalConfigHash) || typeof journal.expectedConfigHash !== "string" || !HASH_PATTERN.test(journal.expectedConfigHash) || typeof journal.planId !== "string" || !HASH_PATTERN.test(journal.planId)) {
    throw invalidJournal("config path, config hashes, or planId is invalid");
  }
  if (journal.targetInitialState !== "missing" && journal.targetInitialState !== "empty") {
    throw invalidJournal("targetInitialState is invalid");
  }
  const targetInitialState = journal.targetInitialState;
  const manifest = parseManifest(journal.manifest);
  const identity = {
    source: journal.source,
    target: journal.target,
    targetInitialState,
    fileCount: manifest.files.length,
    directoryCount: manifest.directories.length,
    totalBytes: manifest.totalBytes,
    manifestHash: manifest.hash,
    configPath: journal.configPath,
    originalConfigHash: journal.originalConfigHash,
    expectedConfigHash: journal.expectedConfigHash
  };
  if (v1PlanIdFor(identity) !== journal.planId) {
    throw invalidJournal("planId does not match the bound config and tree");
  }
  return {
    schema: "comet.classic-root-move.v1",
    id: journal.id,
    stage: journal.stage,
    source: journal.source,
    target: journal.target,
    staging: journal.staging,
    configPath: journal.configPath,
    originalConfigHash: journal.originalConfigHash,
    expectedConfigHash: journal.expectedConfigHash,
    planId: journal.planId,
    targetInitialState,
    manifest
  };
}
function parseJournalV2(journal) {
  assertExactKeys(
    journal,
    [
      "schema",
      "id",
      "stage",
      "source",
      "target",
      "staging",
      "artifactLayout",
      "sourceIdentity",
      "targetInitialIdentity",
      "configPath",
      "originalConfigHash",
      "expectedConfigHash",
      "planId",
      "approvedPlanId",
      "targetInitialState",
      "manifest"
    ],
    "root"
  );
  if (typeof journal.id !== "string" || !UUID_PATTERN2.test(journal.id)) {
    throw invalidJournal("id is invalid");
  }
  if (journal.stage !== "locked" && journal.stage !== "copying" && journal.stage !== "ready" && journal.stage !== "switched" && journal.stage !== "configured") {
    throw invalidJournal("stage is invalid");
  }
  const expectedStaging = `.comet/transactions/classic-root-move/${journal.id}/openspec`;
  if (journal.source !== "openspec" || journal.target !== "docs/openspec" || journal.staging !== expectedStaging) {
    throw invalidJournal("source, target, and staging must use the managed project paths");
  }
  if (journal.artifactLayout !== "legacy") {
    throw invalidJournal("artifactLayout must be legacy");
  }
  const sourceIdentity = parseSourceIdentity(journal.sourceIdentity);
  if (journal.configPath !== WORKFLOW_PROJECT_CONFIG_PATH || typeof journal.originalConfigHash !== "string" || !HASH_PATTERN.test(journal.originalConfigHash) || typeof journal.expectedConfigHash !== "string" || !HASH_PATTERN.test(journal.expectedConfigHash) || typeof journal.planId !== "string" || !HASH_PATTERN.test(journal.planId) || typeof journal.approvedPlanId !== "string" || !HASH_PATTERN.test(journal.approvedPlanId)) {
    throw invalidJournal("config path, config hashes, planId, or approvedPlanId is invalid");
  }
  const targetInitialState = journal.targetInitialState;
  if (targetInitialState !== "missing" && targetInitialState !== "empty" && !(journal.stage === "locked" && targetInitialState === "non-empty")) {
    throw invalidJournal("targetInitialState is invalid");
  }
  const targetInitialIdentity = journal.targetInitialIdentity === null ? null : parseObjectIdentity(journal.targetInitialIdentity, "targetInitialIdentity");
  if (targetInitialState === "missing" && targetInitialIdentity !== null || targetInitialState !== "missing" && targetInitialIdentity === null) {
    throw invalidJournal("targetInitialIdentity does not match targetInitialState");
  }
  const manifest = parseManifest(journal.manifest);
  const identity = {
    source: journal.source,
    target: journal.target,
    staging: STAGING_PLAN_IDENTITY,
    artifactLayout: "legacy",
    sourceIdentity,
    targetInitialIdentity,
    targetInitialState,
    fileCount: manifest.files.length,
    directoryCount: manifest.directories.length,
    totalBytes: manifest.totalBytes,
    manifestHash: manifest.hash,
    configPath: journal.configPath,
    originalConfigHash: journal.originalConfigHash,
    expectedConfigHash: journal.expectedConfigHash
  };
  if (planIdFor(identity) !== journal.planId) {
    throw invalidJournal("planId does not match the bound config and tree");
  }
  if (journal.stage !== "locked" && journal.approvedPlanId !== journal.planId) {
    throw invalidJournal("approvedPlanId does not match the executable plan");
  }
  return {
    schema: "comet.classic-root-move.v2",
    id: journal.id,
    stage: journal.stage,
    source: journal.source,
    target: journal.target,
    staging: journal.staging,
    artifactLayout: "legacy",
    sourceIdentity,
    targetInitialIdentity,
    configPath: journal.configPath,
    originalConfigHash: journal.originalConfigHash,
    expectedConfigHash: journal.expectedConfigHash,
    planId: journal.planId,
    approvedPlanId: journal.approvedPlanId,
    targetInitialState,
    manifest
  };
}
function parseJournal(value) {
  const journal = record(value, "root");
  if (journal.schema === "comet.classic-root-move.v1") return parseJournalV1(journal);
  if (journal.schema === "comet.classic-root-move.v2") return parseJournalV2(journal);
  throw invalidJournal("schema is unsupported");
}
async function readJournal(projectRoot, testHooks) {
  return readJournalAtPath(
    projectRoot,
    journalFile(projectRoot),
    JOURNAL_RELATIVE_PATH,
    testHooks?.afterJournalInspect
  );
}
async function readJournalAtPath(projectRoot, file, label, afterInspect) {
  await assertProtectedMovePath(projectRoot, file, label, "file");
  try {
    const stat = await fs21.lstat(file, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > BigInt(MAX_JOURNAL_BYTES)) {
      throw invalidJournal("journal must be a bounded regular file");
    }
    await afterInspect?.();
    const bytes = await readRootMoveFile(
      projectRoot,
      file,
      MAX_JOURNAL_BYTES,
      "Classic root move journal",
      stat
    );
    const journal = parseJournal(JSON.parse(bytes.toString("utf8")));
    Object.defineProperty(journal, journalClaimBrand, {
      value: {
        fileIdentity: stat,
        contentHash: hashBytes(bytes)
      },
      enumerable: false
    });
    return journal;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function journalClaim(journal) {
  const claim = journal[journalClaimBrand];
  if (!claim) throw new Error("Classic root move journal has no ownership claim");
  return claim;
}
function sameJournalOwnership(expected, actual) {
  const expectedClaim = journalClaim(expected);
  const actualClaim = journalClaim(actual);
  return sameInspectedFile(expectedClaim.fileIdentity, actualClaim.fileIdentity) && expectedClaim.contentHash === actualClaim.contentHash && expected.schema === actual.schema && expected.id === actual.id && expected.stage === actual.stage && expected.planId === actual.planId;
}
async function validateOwnedJournal(projectRoot, expected) {
  const current = await readJournalAtPath(
    projectRoot,
    journalFile(projectRoot),
    JOURNAL_RELATIVE_PATH
  );
  if (!current || !sameJournalOwnership(expected, current)) {
    throw new Error("Classic root move journal ownership changed");
  }
}
async function restoreQuarantinedJournal(projectRoot, quarantine, operation, testHooks) {
  const file = journalFile(projectRoot);
  try {
    await linkProtectedFileExclusive(
      projectRoot,
      quarantine.file,
      file,
      `${operation}-publish`,
      testHooks
    );
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
  const restored = await readJournal(projectRoot);
  if (!restored || !sameJournalOwnership(quarantine.journal, restored)) {
    throw new Error("Classic root move journal ownership changed while restoring quarantine");
  }
  await unlinkProtectedFile(
    projectRoot,
    quarantine.file,
    `${operation}-cleanup-quarantine`,
    testHooks,
    { expectedIdentity: journalClaim(quarantine.journal).fileIdentity }
  );
  return true;
}
async function quarantineOwnedJournal(projectRoot, expected, operation, testHooks) {
  const file = journalFile(projectRoot);
  const quarantineFile = `${file}.${expected.id}.${randomUUID8()}.quarantine`;
  await validateOwnedJournal(projectRoot, expected);
  const parent = await captureProtectedDirectoryChain(
    projectRoot,
    path30.dirname(file),
    `Classic root move ${operation} quarantine`
  );
  await testHooks?.beforeMutation?.(`${operation}-quarantine`);
  await validateProtectedDirectoryChain(parent, `Classic root move ${operation} quarantine`);
  await validateOwnedJournal(projectRoot, expected);
  await fs21.rename(file, quarantineFile);
  await validateProtectedDirectoryChain(parent, `Classic root move ${operation} quarantine`);
  const moved = await readJournalAtPath(
    projectRoot,
    quarantineFile,
    projectRelative2(projectRoot, quarantineFile)
  ).catch(async (error) => {
    await restoreQuarantinedPath(
      projectRoot,
      quarantineFile,
      `${operation}-restore-unverified`,
      testHooks
    ).catch(() => false);
    throw new Error("Classic root move journal ownership changed while quarantining", {
      cause: error
    });
  });
  if (!moved || !sameJournalOwnership(expected, moved)) {
    await restoreQuarantinedPath(
      projectRoot,
      quarantineFile,
      `${operation}-restore-successor`,
      testHooks
    ).catch(() => false);
    throw new Error("Classic root move journal ownership changed while quarantining");
  }
  await testHooks?.afterJournalQuarantine?.(operation);
  return { file: quarantineFile, journal: moved };
}
async function restoreQuarantinedPath(projectRoot, quarantineFile, operation, testHooks) {
  const file = journalFile(projectRoot);
  let identity;
  try {
    identity = await captureMutationObject(
      quarantineFile,
      "file",
      `Classic root move ${operation}`
    );
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  try {
    await linkProtectedFileExclusive(
      projectRoot,
      quarantineFile,
      file,
      `${operation}-publish`,
      testHooks
    );
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
  await unlinkProtectedFile(
    projectRoot,
    quarantineFile,
    `${operation}-cleanup-quarantine`,
    testHooks,
    { expectedIdentity: identity }
  );
  return true;
}
async function unlinkOwnedJournal(projectRoot, journal, operation, testHooks) {
  const quarantine = await quarantineOwnedJournal(projectRoot, journal, operation, testHooks);
  try {
    const removed = await unlinkProtectedFile(
      projectRoot,
      quarantine.file,
      `${operation}-quarantined`,
      testHooks,
      { expectedIdentity: journalClaim(quarantine.journal).fileIdentity }
    );
    if (!removed) {
      throw new Error("Classic root move quarantined journal disappeared before removal");
    }
    return true;
  } catch (error) {
    await restoreQuarantinedJournal(
      projectRoot,
      quarantine,
      `${operation}-restore`,
      testHooks
    ).catch(() => false);
    throw error;
  }
}
async function updateJournal(projectRoot, journal, stage, testHooks) {
  if (journal.schema === "comet.classic-root-move.v1" && stage === "locked") {
    throw new Error("Legacy Classic root move journals do not support the locked stage");
  }
  const updated = { ...journal, stage };
  return atomicWriteJournal(projectRoot, journal, updated, testHooks);
}
function transactionPaths(projectRoot, journal) {
  const layouts = {
    legacy: classicLayoutPaths(projectRoot, "legacy"),
    docs: classicLayoutPaths(projectRoot, "docs")
  };
  const transactionRoot = path30.join(
    projectRoot,
    ".comet",
    "transactions",
    "classic-root-move",
    journal.id
  );
  return {
    source: layouts.legacy.openSpecRoot,
    target: layouts.docs.openSpecRoot,
    staging: path30.join(transactionRoot, "openspec"),
    quarantine: path30.join(transactionRoot, "legacy-source"),
    transactionRoot
  };
}
async function treeStatus(projectRoot, root, manifest) {
  if (!await protectedDirectoryExists(projectRoot, root, "Classic root move tree")) {
    return "missing";
  }
  try {
    return sameManifest(await scanTree(projectRoot, root), manifest) ? "match" : "mismatch";
  } catch {
    return "mismatch";
  }
}
async function targetTreeStatus(projectRoot, root, manifest) {
  if (!await protectedDirectoryExists(projectRoot, root, "Classic root move target")) {
    return "missing";
  }
  try {
    const actual = await scanTree(projectRoot, root);
    if (sameManifest(actual, manifest)) return "match";
    if (actual.directories.length === 0 && actual.files.length === 0) return "empty";
    return "mismatch";
  } catch {
    return "mismatch";
  }
}
async function manifestSubsetStatus(projectRoot, root, manifest) {
  if (!await protectedDirectoryExists(projectRoot, root, "Classic root move manifest tree")) {
    return { status: "missing" };
  }
  try {
    const actual = await scanTree(projectRoot, root);
    if (sameManifest(actual, manifest)) return { status: "complete", actual };
    const expectedDirectories = new Set(manifest.directories);
    const expectedFiles = new Map(manifest.files.map((file) => [file.path, file]));
    if (actual.directories.some((directory) => !expectedDirectories.has(directory))) {
      return { status: "mismatch" };
    }
    for (const file of actual.files) {
      const expected = expectedFiles.get(file.path);
      if (!expected || expected.size !== file.size || expected.hash !== file.hash) {
        return { status: "mismatch" };
      }
    }
    return { status: "partial", actual };
  } catch {
    return { status: "mismatch" };
  }
}
async function cleanupManifestBoundTree(projectRoot, root, manifest, testHooks, operationPrefix = "remove-quarantine") {
  const inspection = await manifestSubsetStatus(projectRoot, root, manifest);
  if (inspection.status === "missing") return;
  if (inspection.status === "mismatch" || !inspection.actual) {
    throw new Error("Classic quarantine contains unknown or changed content; files were preserved");
  }
  for (const file of inspection.actual.files) {
    const absolute = path30.join(root, ...file.path.split("/"));
    let stat;
    try {
      stat = await fs21.lstat(absolute, { bigint: true });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const bytes = stat.isFile() && !stat.isSymbolicLink() ? await readRootMoveFile(
      projectRoot,
      absolute,
      Math.max(1, file.size),
      `Classic root move quarantine file ${file.path}`,
      stat
    ) : null;
    if (!bytes || bytes.byteLength !== file.size || hashBytes(bytes) !== file.hash) {
      throw new Error(
        "Classic quarantine contains unknown or changed content; files were preserved"
      );
    }
    await unlinkProtectedFile(
      projectRoot,
      absolute,
      `${operationPrefix}-file:${file.path}`,
      testHooks
    );
  }
  const directories = [...inspection.actual.directories].sort((left, right) => {
    const depth = right.split("/").length - left.split("/").length;
    return depth === 0 ? right.localeCompare(left) : depth;
  });
  for (const directory of directories) {
    const absolute = path30.join(root, ...directory.split("/"));
    await removeProtectedEmptyDirectory(
      projectRoot,
      absolute,
      `${operationPrefix}-directory:${directory}`,
      testHooks
    );
  }
  await removeProtectedEmptyDirectory(projectRoot, root, `${operationPrefix}-root`, testHooks);
}
async function consumeBoundEmptyTarget(projectRoot, target, journal, testHooks) {
  const state = await targetTreeStatus(projectRoot, target, journal.manifest);
  if (journal.targetInitialState === "missing") {
    if (state !== "missing") {
      throw new Error("Classic docs target changed after migration preflight");
    }
    return;
  }
  if (state === "empty") {
    if (journal.schema === "comet.classic-root-move.v2" && !journal.targetInitialIdentity) {
      throw new Error("Classic docs target identity is missing from the approved plan");
    }
    await removeProtectedEmptyDirectory(
      projectRoot,
      target,
      "remove-empty-target",
      testHooks,
      journal.schema === "comet.classic-root-move.v2" ? journal.targetInitialIdentity ?? void 0 : void 0
    );
    return;
  }
  if (state !== "missing") {
    throw new Error("Classic docs target changed after migration preflight");
  }
}
async function assertBoundSourceIdentity(projectRoot, source, journal) {
  if (journal.schema === "comet.classic-root-move.v1") return;
  const current = await captureStableSourceIdentity(
    projectRoot,
    source,
    "Classic legacy root identity"
  );
  if (!sameStableChain(current, journal.sourceIdentity)) {
    throw new Error("Classic legacy root identity changed after migration preflight");
  }
}
async function assertOriginalConfig(projectRoot, journal) {
  if (await projectConfigHash(projectRoot) !== journal.originalConfigHash) {
    throw new Error("Classic project config changed after migration preflight");
  }
  if (await readClassicArtifactLayout(projectRoot) !== "legacy") {
    throw new Error("Classic project config changed after migration preflight");
  }
}
async function assertExpectedConfig(projectRoot, journal) {
  if (await projectConfigHash(projectRoot) !== journal.expectedConfigHash) {
    throw new Error("Classic project config does not match the expected post-switch config hash");
  }
  if (await readClassicArtifactLayout(projectRoot) !== "docs") {
    throw new Error("Classic project config does not match the expected post-switch config hash");
  }
}
async function assertTreeMatches(projectRoot, root, manifest, message) {
  if (await treeStatus(projectRoot, root, manifest) !== "match") throw new Error(message);
}
async function finishJournal(projectRoot, journal, testHooks) {
  if (journal.stage === "locked") {
    throw new Error("Classic root move locked preflight must be approved before execution");
  }
  await assertRootMovePreflightBoundaries(projectRoot, journal.id);
  const { source, target, staging, quarantine, transactionRoot } = transactionPaths(
    projectRoot,
    journal
  );
  let current = journal;
  if (current.stage === "copying") {
    await assertOriginalConfig(projectRoot, current);
    await assertBoundSourceIdentity(projectRoot, source, current);
    await assertTreeMatches(
      projectRoot,
      source,
      current.manifest,
      "Classic legacy root changed after migration preflight"
    );
    await consumeBoundEmptyTarget(projectRoot, target, current, testHooks);
    const staged = await treeStatus(projectRoot, staging, current.manifest);
    if (staged === "mismatch") {
      throw new Error("Classic root move staging changed after migration preflight");
    }
    if (staged === "missing") {
      await copyManifest(projectRoot, source, staging, current.manifest, testHooks);
    }
    await assertTreeMatches(
      projectRoot,
      staging,
      current.manifest,
      "Classic root move staging verification failed"
    );
    current = await updateJournal(projectRoot, current, "ready", testHooks);
  }
  if (current.stage === "ready") {
    await assertOriginalConfig(projectRoot, current);
    await assertBoundSourceIdentity(projectRoot, source, current);
    await assertTreeMatches(
      projectRoot,
      source,
      current.manifest,
      "Classic legacy root changed after migration preflight"
    );
    const staged = await treeStatus(projectRoot, staging, current.manifest);
    const targetState = await targetTreeStatus(projectRoot, target, current.manifest);
    if (staged === "missing" && targetState === "match") {
      current = await updateJournal(projectRoot, current, "switched", testHooks);
    } else {
      if (staged !== "match") {
        throw new Error("Classic root move staging changed after migration preflight");
      }
      if (targetState === "mismatch" || targetState === "empty") {
        throw new Error("Classic docs target changed after migration preflight");
      }
      if (targetState === "missing") {
        await ensureRootMoveDirectory(
          projectRoot,
          path30.dirname(target),
          "Classic docs target parent",
          testHooks
        );
        await renameProtectedPath(projectRoot, staging, target, "rename-staging-target", testHooks);
        current = await updateJournal(projectRoot, current, "switched", testHooks);
      }
    }
  }
  if (current.stage === "switched") {
    await assertBoundSourceIdentity(projectRoot, source, current);
    await assertTreeMatches(
      projectRoot,
      source,
      current.manifest,
      "Classic legacy root changed before config switch"
    );
    await assertTreeMatches(
      projectRoot,
      target,
      current.manifest,
      "Classic docs target verification failed after switch"
    );
    const layout = await readClassicArtifactLayout(projectRoot);
    if (layout === "legacy") {
      await assertOriginalConfig(projectRoot, current);
      await writeClassicArtifactLayout(projectRoot, "docs", {
        expectedIdentity: {
          exists: true,
          sha256: current.originalConfigHash
        }
      });
    } else if (layout !== "docs") {
      throw new Error("Classic project config changed after migration preflight");
    }
    await assertExpectedConfig(projectRoot, current);
    current = await updateJournal(projectRoot, current, "configured", testHooks);
  }
  if (current.stage !== "configured") {
    throw new Error(`Unsupported Classic root move stage: ${current.stage}`);
  }
  await assertExpectedConfig(projectRoot, current);
  await assertTreeMatches(
    projectRoot,
    target,
    current.manifest,
    "Classic docs target verification failed after config switch"
  );
  if (await protectedDirectoryExists(projectRoot, source, "Classic legacy root")) {
    await assertBoundSourceIdentity(projectRoot, source, current);
    await assertTreeMatches(
      projectRoot,
      source,
      current.manifest,
      "Classic legacy root changed before cleanup; both roots were preserved"
    );
    if (await protectedDirectoryExists(projectRoot, quarantine, "Classic root move quarantine")) {
      throw new Error("Classic root move quarantine conflicts with the legacy root");
    }
    await renameProtectedPath(
      projectRoot,
      source,
      quarantine,
      "rename-source-quarantine",
      testHooks
    );
  }
  if (await protectedDirectoryExists(projectRoot, quarantine, "Classic root move quarantine")) {
    await cleanupManifestBoundTree(projectRoot, quarantine, current.manifest, testHooks);
  }
  await removeProtectedEmptyDirectory(
    projectRoot,
    transactionRoot,
    "remove-transaction-root",
    testHooks
  );
  await unlinkOwnedJournal(projectRoot, current, "remove-journal", testHooks);
}
async function recoveryPolicy(projectRoot, journal) {
  await assertRootMovePreflightBoundaries(projectRoot, journal.id);
  if (journal.stage === "locked") {
    return {
      allowedStrategies: ["rollback"],
      reason: "the locked apply preflight was not approved for execution"
    };
  }
  const { source, target, staging, quarantine } = transactionPaths(projectRoot, journal);
  const layout = await readClassicArtifactLayout(projectRoot);
  const currentConfigHash = await projectConfigHash(projectRoot);
  const originalConfigMatches = layout === "legacy" && currentConfigHash === journal.originalConfigHash;
  const expectedConfigMatches = layout === "docs" && currentConfigHash === journal.expectedConfigHash;
  const [sourceState, targetState, stagingState, quarantineInspection] = await Promise.all([
    treeStatus(projectRoot, source, journal.manifest),
    targetTreeStatus(projectRoot, target, journal.manifest),
    treeStatus(projectRoot, staging, journal.manifest),
    manifestSubsetStatus(projectRoot, quarantine, journal.manifest)
  ]);
  const quarantineState = quarantineInspection.status;
  if (sourceState === "mismatch") {
    return {
      allowedStrategies: [],
      reason: "Classic legacy root changed after migration preflight"
    };
  }
  if (targetState === "mismatch") {
    return {
      allowedStrategies: [],
      reason: "Classic docs target changed after migration preflight"
    };
  }
  if (stagingState === "mismatch") {
    return { allowedStrategies: [], reason: "Classic staging changed after migration preflight" };
  }
  if (quarantineState === "mismatch") {
    return {
      allowedStrategies: [],
      reason: "Classic quarantine contains unknown or changed content"
    };
  }
  if (journal.stage === "configured" || layout === "docs") {
    if (!expectedConfigMatches) {
      return {
        allowedStrategies: [],
        reason: "project config does not match the expected post-switch config hash"
      };
    }
    const sourceRecoverable = sourceState === "match" && quarantineState === "missing" || sourceState === "missing" && (quarantineState === "missing" || quarantineState === "complete" || quarantineState === "partial");
    return targetState === "match" && sourceRecoverable ? { allowedStrategies: ["continue"] } : { allowedStrategies: [], reason: "the configured migration trees are incomplete" };
  }
  if (!originalConfigMatches) {
    return {
      allowedStrategies: [],
      reason: "project config changed after migration preflight"
    };
  }
  const sourceMatches = sourceState === "match";
  const stagedOrAbsent = stagingState === "match" || stagingState === "missing";
  const targetOrAbsent = targetState === "match" || targetState === "missing" || journal.targetInitialState === "empty" && targetState === "empty";
  if (!sourceMatches || !stagedOrAbsent || !targetOrAbsent || quarantineState !== "missing") {
    return { allowedStrategies: [], reason: "the migration trees are not recoverable" };
  }
  return { allowedStrategies: ["continue", "rollback"] };
}
async function planClassicRootMove(startPath, options = {}) {
  const projectRoot = await discoverClassicProject(startPath);
  const journal = await readJournal(projectRoot, options.testHooks);
  if (journal) {
    const pendingRecovery = await inspectClassicRootMove(projectRoot);
    if (!pendingRecovery)
      throw new Error("Classic root move journal disappeared during inspection");
    return {
      projectRoot,
      source: journal.source,
      target: journal.target,
      staging: journal.staging,
      artifactLayout: "legacy",
      sourceIdentity: journal.schema === "comet.classic-root-move.v2" ? journal.sourceIdentity.map((identity) => ({ ...identity })) : [],
      targetInitialIdentity: journal.schema === "comet.classic-root-move.v2" && journal.targetInitialIdentity ? { ...journal.targetInitialIdentity } : null,
      fileCount: journal.manifest.files.length,
      directoryCount: journal.manifest.directories.length,
      totalBytes: journal.manifest.totalBytes,
      manifestHash: journal.manifest.hash,
      configPath: journal.configPath,
      configHash: journal.originalConfigHash,
      originalConfigHash: journal.originalConfigHash,
      expectedConfigHash: journal.expectedConfigHash,
      planId: journal.planId,
      fileSummary: journal.manifest.files.map((file) => ({ ...file })),
      configChange: { from: "legacy", to: "docs" },
      conflicts: pendingRecovery.reason ? [pendingRecovery.reason] : [],
      blockers: [`pending Classic root move: ${journal.id} at ${journal.stage}`],
      pendingRecovery,
      historicalPointersPreserved: [...HISTORICAL_POINTERS_PRESERVED],
      applyPreconditions: [...APPLY_PRECONDITIONS],
      allowedRecoveryStrategies: [...pendingRecovery.allowedStrategies],
      targetInitialState: journal.targetInitialState,
      readyToApply: false
    };
  }
  return (await preflight2(projectRoot, options)).plan;
}
async function applyClassicRootMove(startPath, options = {}) {
  const projectRoot = await discoverClassicProject(startPath);
  const existing = await readJournal(projectRoot, options.testHooks);
  if (existing) {
    throw new Error(
      `Classic root move ${existing.id} is incomplete; use comet doctor --repair --strategy continue|rollback`
    );
  }
  const initial = await preflight2(projectRoot);
  const approvedPlanId = options.planId ?? initial.plan.planId;
  if (!HASH_PATTERN.test(approvedPlanId)) {
    throw new Error("Classic root move apply received an invalid internal plan ID");
  }
  const id = randomUUID8();
  await assertRootMovePreflightBoundaries(projectRoot, id);
  const lockedJournal = {
    schema: "comet.classic-root-move.v2",
    id,
    stage: "locked",
    source: initial.plan.source,
    target: initial.plan.target,
    staging: `.comet/transactions/classic-root-move/${id}/openspec`,
    artifactLayout: initial.plan.artifactLayout,
    sourceIdentity: initial.plan.sourceIdentity.map((identity) => ({ ...identity })),
    targetInitialIdentity: initial.plan.targetInitialIdentity ? { ...initial.plan.targetInitialIdentity } : null,
    configPath: WORKFLOW_PROJECT_CONFIG_PATH,
    originalConfigHash: initial.plan.originalConfigHash,
    expectedConfigHash: initial.plan.expectedConfigHash,
    planId: initial.plan.planId,
    approvedPlanId,
    targetInitialState: initial.plan.targetInitialState,
    manifest: initial.manifest
  };
  await createJsonExclusive(
    projectRoot,
    journalFile(projectRoot),
    lockedJournal,
    options.testHooks
  );
  const ownedLock = await readJournal(projectRoot);
  if (!ownedLock || ownedLock.id !== id || ownedLock.stage !== "locked") {
    throw new Error("Classic root move lock ownership changed before locked preflight");
  }
  let executionStarted = false;
  try {
    const lockedPreflight = await preflight2(projectRoot, options);
    const plan = lockedPreflight.plan;
    if (plan.planId !== approvedPlanId) {
      throw new Error(
        `Classic root move plan changed since dry-run: approved ${approvedPlanId}, current ${plan.planId}`
      );
    }
    if (!plan.readyToApply) {
      throw new Error(
        `Classic root move apply is blocked: ${[...plan.conflicts, ...plan.blockers].join("; ")}`
      );
    }
    if (plan.targetInitialState === "non-empty") {
      throw new Error("Classic root move apply is blocked: Classic docs target is not empty");
    }
    const journal = {
      schema: "comet.classic-root-move.v2",
      id,
      stage: "copying",
      source: plan.source,
      target: plan.target,
      staging: `.comet/transactions/classic-root-move/${id}/openspec`,
      artifactLayout: plan.artifactLayout,
      sourceIdentity: plan.sourceIdentity.map((identity) => ({ ...identity })),
      targetInitialIdentity: plan.targetInitialIdentity ? { ...plan.targetInitialIdentity } : null,
      configPath: WORKFLOW_PROJECT_CONFIG_PATH,
      originalConfigHash: plan.originalConfigHash,
      expectedConfigHash: plan.expectedConfigHash,
      planId: plan.planId,
      approvedPlanId,
      targetInitialState: plan.targetInitialState,
      manifest: lockedPreflight.manifest
    };
    const ownedJournal = await atomicWriteJournal(
      projectRoot,
      ownedLock,
      journal,
      options.testHooks
    );
    executionStarted = true;
    await finishJournal(projectRoot, ownedJournal, options.testHooks);
    return { ...plan, staging: journal.staging };
  } catch (error) {
    if (!executionStarted) {
      await unlinkOwnedJournal(
        projectRoot,
        ownedLock,
        "remove-rejected-lock",
        options.testHooks
      ).catch(() => false);
    }
    throw error;
  }
}
async function inspectClassicRootMove(projectRoot, options = {}) {
  const journal = await readJournal(projectRoot, options.testHooks);
  if (!journal) return null;
  const policy = await recoveryPolicy(projectRoot, journal);
  return {
    id: journal.id,
    stage: journal.stage,
    source: journal.source,
    target: journal.target,
    staging: journal.staging,
    planId: journal.planId,
    ...policy
  };
}

// domains/comet-classic/classic-root-command.ts
init_project_config_reader();
function usage3(language = "en") {
  return {
    exitCode: 64,
    stderr: language === "zh-CN" ? "用法：comet classic root show | comet classic root move docs --dry-run | comet classic root move docs --apply" : "Usage: comet classic root show | comet classic root move docs --dry-run | comet classic root move docs --apply"
  };
}
function rootMoveLanguage(config) {
  return config?.classic?.language === "en" ? "en" : "zh-CN";
}
function formatClassicRootMoveError(error, language) {
  const message = error instanceof Error ? error.message : String(error);
  if (language === "en") return message;
  if (message === "invalid Classic root move journal: manifest paths must be unique and sorted") {
    return "Classic 根目录迁移失败：迁移记录中的清单路径必须唯一且按顺序排列";
  }
  if (message.startsWith("invalid Classic root move journal:")) {
    return "Classic 根目录迁移失败：迁移记录格式或内容无效，请运行 comet doctor 检查恢复状态";
  }
  return "Classic 根目录迁移失败：迁移过程中发生错误，请运行 comet doctor 检查迁移状态";
}
function formatClassicRootMoveReport(plan, mode, language = "en") {
  const zh = language === "zh-CN";
  const list = (values) => values.length > 0 ? values.join("; ") : zh ? "无" : "none";
  const localizedReason = (value) => {
    if (!zh) return value;
    const pending = /^pending Classic root move: (.+) at (.+)$/u.exec(value);
    if (pending) return `存在待恢复的 Classic 根目录迁移：${pending[1]}，阶段 ${pending[2]}`;
    return {
      "Classic docs target is not empty": "docs 目标目录非空",
      "the locked apply preflight was not approved for execution": "已锁定的迁移预检尚未获准执行",
      "Classic legacy root changed after migration preflight": "迁移预检后 legacy 根目录发生变化",
      "Classic docs target changed after migration preflight": "迁移预检后 docs 目标目录发生变化",
      "Classic staging changed after migration preflight": "迁移预检后暂存目录发生变化",
      "Classic quarantine contains unknown or changed content": "隔离目录包含未知或已变化的内容",
      "project config does not match the expected post-switch config hash": "项目配置与切换后的预期配置哈希不一致",
      "the configured migration trees are incomplete": "已切换配置对应的迁移目录不完整",
      "project config changed after migration preflight": "迁移预检后项目配置发生变化",
      "the migration trees are not recoverable": "迁移目录当前无法安全恢复"
    }[value] ?? "迁移状态存在无法识别的冲突，请运行 comet doctor 检查恢复状态";
  };
  const reasonLines = (label, values) => values.length === 0 ? [`${label}: ${zh ? "无" : "none"}`] : [`${label}:`, ...values.map((value) => `- ${localizedReason(value)}`)];
  const targetState = zh ? { missing: "缺失", empty: "空目录", "non-empty": "非空目录" }[plan.targetInitialState] : plan.targetInitialState;
  const historicalPointers = zh ? "handoff 哈希；运行状态；检查点；轨迹；已归档证据与产物指针" : plan.historicalPointersPreserved.join("; ");
  const applyPreconditions = zh ? "内部迁移身份仍与布局、源目录、清单、目标目录和配置一致；不存在待恢复的根迁移事务；目标仍然缺失或为已绑定的空目录；所有迁移路径仍受保护" : plan.applyPreconditions.join("; ");
  const recoveryStrategies = zh ? plan.allowedRecoveryStrategies.map((strategy) => strategy === "continue" ? "继续" : "回滚") : plan.allowedRecoveryStrategies;
  const lines = [
    mode === "dry-run" ? zh ? "Classic 根目录迁移现状" : "Classic root move status" : zh ? "Classic 根目录迁移完成" : "Classic root move complete",
    ...mode === "dry-run" ? [
      zh ? "说明：仅查看现状，未修改任何文件。" : "Note: Inspection only; no files were changed."
    ] : [],
    `${zh ? "源目录" : "source"}: ${plan.source}`,
    `${zh ? "目标目录" : "target"}: ${plan.target}`,
    `${zh ? "暂存目录" : "staging"}: ${plan.staging}`,
    `${zh ? "当前布局" : "artifact layout"}: ${plan.artifactLayout}`,
    `${zh ? "源目录身份" : "source identity"}: ${JSON.stringify(plan.sourceIdentity)}`,
    `${zh ? "目标初始身份" : "target initial identity"}: ${plan.targetInitialIdentity ? JSON.stringify(plan.targetInitialIdentity) : zh ? "缺失" : "missing"}`,
    `${zh ? "文件数" : "files"}: ${plan.fileCount}`,
    `${zh ? "目录数" : "directories"}: ${plan.directoryCount}`,
    `${zh ? "总字节数" : "bytes"}: ${plan.totalBytes}`,
    `${zh ? "清单哈希" : "manifest"}: ${plan.manifestHash}`,
    ...plan.fileSummary.map(
      (file) => `${zh ? "文件" : "file"}: ${file.path} ${file.size} ${file.hash}`
    ),
    `${zh ? "配置变更" : "config change"}: ${plan.configChange.from} -> ${plan.configChange.to}`,
    `${zh ? "配置路径" : "config path"}: ${plan.configPath}`,
    `${zh ? "配置哈希" : "config"}: ${plan.configHash}`,
    `${zh ? "原配置哈希" : "original config"}: ${plan.originalConfigHash}`,
    `${zh ? "预期配置哈希" : "expected config"}: ${plan.expectedConfigHash}`,
    `${zh ? "目标初始状态" : "target initial state"}: ${targetState}`,
    ...reasonLines(zh ? "冲突" : "conflicts", plan.conflicts),
    ...reasonLines(zh ? "阻塞项" : "blockers", plan.blockers),
    `${zh ? "待恢复事务" : "pending recovery"}: ${plan.pendingRecovery ? `${plan.pendingRecovery.id} ${zh ? "位于阶段" : "at"} ${plan.pendingRecovery.stage}` : zh ? "无" : "none"}`,
    `${zh ? "保留历史指针" : "historical pointers preserved"}: ${historicalPointers}`,
    `${zh ? "执行前提" : "apply preconditions"}: ${applyPreconditions}`,
    `${zh ? "允许的恢复策略" : "allowed recovery strategies"}: ${list(recoveryStrategies)}`,
    `${zh ? "可执行迁移" : "ready to apply"}: ${plan.readyToApply ? zh ? "是" : "yes" : zh ? "否" : "no"}`
  ];
  if (mode === "dry-run") {
    lines.push(
      plan.readyToApply ? zh ? "下一步：运行 comet classic root move docs --apply 执行迁移。" : "Next: run comet classic root move docs --apply to apply the migration." : zh ? "下一步：请先解决上述冲突或阻塞项。" : "Next: resolve the conflicts or blockers above before applying."
    );
  } else {
    lines.push(zh ? "结果：迁移已完成。" : "Result: Migration completed.");
  }
  return `${lines.join("\n")}
`;
}
function formatAlreadyMigratedReport(layout, mode, language) {
  const root = classicProjectRelative(layout.projectRoot, layout.openSpecRoot);
  if (language === "zh-CN") {
    return [
      mode === "dry-run" ? "Classic 根目录迁移现状" : "Classic 根目录迁移完成",
      `当前布局: ${layout.artifactLayout}`,
      `Classic 根目录: ${root}`,
      mode === "dry-run" ? "说明：项目已经使用 docs/openspec，仅查看现状，未修改任何文件。" : "结果：项目已经使用 docs/openspec，无需重复迁移，未修改任何文件。"
    ].join("\n") + "\n";
  }
  return [
    mode === "dry-run" ? "Classic root move status" : "Classic root move complete",
    `current layout: ${layout.artifactLayout}`,
    `Classic root: ${root}`,
    mode === "dry-run" ? "Note: The project already uses docs/openspec. Inspection only; no files were changed." : "Result: The project already uses docs/openspec. No migration was needed and no files were changed."
  ].join("\n") + "\n";
}
var classicRootCommand = async (args) => {
  const [action, target, mode, ...extra] = args;
  if (action === "show" && target === void 0) {
    const projectRoot2 = await discoverClassicProject(process.cwd());
    const layout2 = await assertClassicLayoutReadable(projectRoot2);
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        schema: "comet.classic-layout.v1",
        artifactLayout: layout2.artifactLayout,
        openSpecRoot: classicProjectRelative(projectRoot2, layout2.openSpecRoot),
        changesRoot: classicProjectRelative(projectRoot2, layout2.changesDir),
        archiveRoot: classicProjectRelative(projectRoot2, layout2.archiveDir),
        specsRoot: classicProjectRelative(projectRoot2, layout2.specsDir),
        superpowersRoot: classicProjectRelative(projectRoot2, layout2.superpowersRoot)
      }) + "\n"
    };
  }
  if (action !== "move" || target !== "docs") return usage3();
  const projectRoot = await discoverClassicProject(process.cwd());
  const config = await readWorkflowProjectConfig(projectRoot);
  const language = rootMoveLanguage(config);
  if (mode !== "--dry-run" && mode !== "--apply" || extra.length > 0) {
    return usage3(language);
  }
  const layout = await assertClassicLayoutReadable(projectRoot);
  const reportMode = mode === "--dry-run" ? "dry-run" : "complete";
  if (layout.artifactLayout === "docs") {
    return {
      exitCode: 0,
      stdout: formatAlreadyMigratedReport(layout, reportMode, language)
    };
  }
  try {
    if (mode === "--dry-run") {
      const plan2 = await planClassicRootMove(projectRoot);
      return {
        exitCode: 0,
        stdout: formatClassicRootMoveReport(plan2, "dry-run", language)
      };
    }
    const plan = await applyClassicRootMove(projectRoot);
    return {
      exitCode: 0,
      stdout: formatClassicRootMoveReport(plan, "complete", language)
    };
  } catch (error) {
    return {
      exitCode: 70,
      stderr: formatClassicRootMoveError(error, language)
    };
  }
};

// domains/comet-classic/classic-state-command.ts
var import_yaml9 = __toESM(require_dist(), 1);
import { spawnSync as spawnSync3 } from "child_process";
import { promises as fs22 } from "fs";
import path31 from "path";
init_state();
var GREEN5 = "\x1B[32m";
var RED5 = "\x1B[31m";
var YELLOW5 = "\x1B[33m";
var RESET5 = "\x1B[0m";
var PROFILES = ["full", "hotfix", "tweak"];
var PHASES3 = ["open", "design", "build", "verify", "archive"];
var ARTIFACT_LANGUAGES2 = ["en", "zh-CN"];
var EVENTS = CLASSIC_TRANSITION_EVENTS;
var MACHINE_OWNED_FIELDS = /* @__PURE__ */ new Set([
  ...RUN_WIRE_KEYS,
  "archive_confirmation",
  "verify_failures",
  "classic_profile",
  "classic_migration",
  "bound_branch"
]);
var SETTABLE_FIELDS = new Set(
  CLASSIC_WIRE_KEYS.filter((field2) => !MACHINE_OWNED_FIELDS.has(field2))
);
var FIELD_ENUMS = {
  workflow: PROFILES,
  phase: PHASES3,
  context_compression: ["off", "beta"],
  build_mode: ["subagent-driven-development", "executing-plans", "direct"],
  build_pause: ["null", "plan-ready"],
  subagent_dispatch: ["null", "confirmed"],
  tdd_mode: ["tdd", "direct"],
  review_mode: ["off", "standard", "thorough"],
  isolation: ["current", "branch", "worktree"],
  verify_mode: ["light", "full"],
  auto_transition: ["true", "false"],
  verify_result: ["pending", "pass", "fail"],
  branch_status: ["pending", "handled"],
  archive_confirmation: ["pending", "confirmed"],
  archived: ["true", "false"],
  direct_override: ["true", "false"],
  classic_profile: PROFILES,
  classic_migration: ["1"]
};
var PATH_FIELDS = /* @__PURE__ */ new Set(["design_doc", "plan", "verification_report", "handoff_context"]);
var CLASSIC_FIELD_WIRE_NAMES2 = {
  archived: "archived",
  branchStatus: "branch_status",
  classicProfile: "classic_profile",
  designDoc: "design_doc",
  language: "language",
  phase: "phase",
  verificationReport: "verification_report",
  verifiedAt: "verified_at",
  archiveConfirmation: "archive_confirmation",
  verifyResult: "verify_result",
  verifyFailures: "verify_failures",
  workflow: "workflow"
};
var CommandFailure = class extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
  exitCode;
};
var CommandOutput = class {
  stdout = [];
  stderr = [];
  result(exitCode = 0) {
    return {
      exitCode,
      ...this.stdout.length > 0 ? { stdout: this.stdout.join("\n") + "\n" } : {},
      ...this.stderr.length > 0 ? { stderr: this.stderr.join("\n") } : {}
    };
  }
};
function green4(message) {
  return `${GREEN5}${message}${RESET5}`;
}
function red4(message) {
  return `${RED5}${message}${RESET5}`;
}
function yellow4(message) {
  return `${YELLOW5}${message}${RESET5}`;
}
function fail2(message) {
  throw new CommandFailure(message);
}
function validateChangeName4(name) {
  const error = openSpecChangeNameError(name);
  if (error) fail2(`ERROR: ${error}`);
}
function validateEnum(value, values) {
  if (!values.includes(value)) {
    fail2(`ERROR: Invalid value: '${value}'
Valid values: ${values.join(" ")}`);
  }
}
function validateLanguage(value, source) {
  if (ARTIFACT_LANGUAGES2.includes(value)) {
    return value;
  }
  fail2(`ERROR: Invalid language from ${source}: '${value}'
Valid values: en, zh-CN`);
}
function validateRelativePath(value, field2) {
  if (!value || value === "null") return;
  if (/^(?:[A-Za-z]:|[\\/]|~)/u.test(value)) {
    fail2(`ERROR: ${field2} must be a relative path within the repo: '${value}'`);
  }
  if (value.split(/[\\/]/u).includes("..")) {
    fail2(`ERROR: ${field2} cannot contain '..' (path traversal not allowed): '${value}'`);
  }
}
async function exists2(file) {
  const projectRoot = classicCommandProjectRoot();
  return classicProjectTargetExists(projectRoot, file, {
    label: `Classic project path ${path31.relative(projectRoot, path31.resolve(projectRoot, file)).replaceAll("\\", "/")}`
  });
}
async function nonempty2(file) {
  const projectRoot = classicCommandProjectRoot();
  return classicProjectFileNonempty(
    projectRoot,
    file,
    `Classic project file ${path31.relative(projectRoot, path31.resolve(projectRoot, file)).replaceAll("\\", "/")}`
  );
}
async function changeDirectory2(name) {
  return resolveClassicChangeDirectory(name, classicCommandProjectRoot());
}
async function readDocument2(file) {
  let source;
  const projectRoot = classicCommandProjectRoot();
  try {
    source = await readClassicProjectFile(projectRoot, file, {
      label: `Classic state ${path31.relative(projectRoot, file).replaceAll("\\", "/")}`
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      fail2(
        `ERROR: .comet.yaml not found at ${path31.relative(projectRoot, file).replaceAll("\\", "/")}`
      );
    }
    throw error;
  }
  const document = (0, import_yaml9.parseDocument)(source, { uniqueKeys: false });
  if (document.errors.length > 0) fail2(`ERROR: Invalid .comet.yaml: ${document.errors[0].message}`);
  return document;
}
async function atomicWrite(file, content) {
  await writeClassicProjectText(classicCommandProjectRoot(), file, content, {
    label: "Classic state write target"
  });
}
function scalar(value) {
  if (value === null) return "null";
  if (value === void 0) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
function wireField2(field2) {
  return CLASSIC_FIELD_WIRE_NAMES2[field2] ?? String(field2);
}
function wireValue2(value) {
  return value === null ? "null" : scalar(value);
}
function enumRecordValue(record2, field2, values, fallback) {
  const value = record2[field2];
  return typeof value === "string" && values.includes(value) ? value : fallback;
}
function nullableRecordString(record2, field2) {
  const value = record2[field2];
  if (value === null || value === void 0 || value === "") return null;
  return typeof value === "string" ? value : String(value);
}
function nullableRecordBoolean(record2, field2) {
  const value = record2[field2];
  if (value === null || value === void 0 || value === "") return null;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}
function nonNegativeRecordInteger(record2, field2, fallback = 0) {
  const value = record2[field2];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}
function sparseClassicState(record2) {
  const workflow = enumRecordValue(record2, "workflow", PROFILES, "full");
  return {
    workflow,
    language: enumRecordValue(record2, "language", ARTIFACT_LANGUAGES2, null),
    phase: enumRecordValue(record2, "phase", PHASES3, "open"),
    contextCompression: enumRecordValue(
      record2,
      "context_compression",
      ["off", "beta"],
      null
    ),
    buildMode: enumRecordValue(
      record2,
      "build_mode",
      ["subagent-driven-development", "executing-plans", "direct"],
      null
    ),
    buildPause: enumRecordValue(record2, "build_pause", ["plan-ready"], null),
    subagentDispatch: enumRecordValue(record2, "subagent_dispatch", ["confirmed"], null),
    tddMode: enumRecordValue(record2, "tdd_mode", ["tdd", "direct"], null),
    reviewMode: enumRecordValue(
      record2,
      "review_mode",
      ["off", "standard", "thorough"],
      null
    ),
    isolation: enumRecordValue(
      record2,
      "isolation",
      ["current", "branch", "worktree"],
      null
    ),
    boundBranch: nullableRecordString(record2, "bound_branch"),
    verifyMode: enumRecordValue(record2, "verify_mode", ["light", "full"], null),
    autoTransition: nullableRecordBoolean(record2, "auto_transition"),
    baseRef: nullableRecordString(record2, "base_ref"),
    designDoc: nullableRecordString(record2, "design_doc"),
    plan: nullableRecordString(record2, "plan"),
    verifyResult: enumRecordValue(
      record2,
      "verify_result",
      ["pending", "pass", "fail"],
      "pending"
    ),
    verifyFailures: nonNegativeRecordInteger(record2, "verify_failures"),
    verificationReport: nullableRecordString(record2, "verification_report"),
    branchStatus: enumRecordValue(record2, "branch_status", ["pending", "handled"], null),
    createdAt: nullableRecordString(record2, "created_at"),
    verifiedAt: nullableRecordString(record2, "verified_at"),
    archiveConfirmation: enumRecordValue(
      record2,
      "archive_confirmation",
      ["pending", "confirmed"],
      null
    ),
    archived: nullableRecordBoolean(record2, "archived") ?? false,
    directOverride: nullableRecordBoolean(record2, "direct_override"),
    handoffContext: nullableRecordString(record2, "handoff_context"),
    handoffHash: nullableRecordString(record2, "handoff_hash"),
    classicProfile: enumRecordValue(record2, "classic_profile", PROFILES, workflow),
    classicMigration: typeof record2.classic_migration === "number" ? record2.classic_migration : null
  };
}
async function projectConfigValue2(field2) {
  return (await readClassicConfigValue(field2, { cwd: classicCommandProjectRoot() }))?.value ?? null;
}
async function projectLanguageDefault() {
  if (process.env.COMET_LANGUAGE)
    return validateLanguage(process.env.COMET_LANGUAGE, "COMET_LANGUAGE");
  const configured = await readClassicConfigValue("language", {
    cwd: classicCommandProjectRoot()
  });
  if (configured) return validateLanguage(configured.value, configured.source);
  return "en";
}
async function contextCompression() {
  const value = process.env.COMET_CONTEXT_COMPRESSION ?? await projectConfigValue2("context_compression") ?? "off";
  if (!["off", "beta"].includes(value)) {
    fail2(`ERROR: Invalid context_compression: '${value}'
Valid values: off, beta`);
  }
  return value;
}
async function autoTransition() {
  const value = process.env.COMET_AUTO_TRANSITION ?? await projectConfigValue2("auto_transition") ?? "true";
  if (!["true", "false"].includes(value)) {
    fail2(`ERROR: Invalid auto_transition: '${value}'
Valid values: true, false`);
  }
  return value;
}
async function reviewModeDefault() {
  const value = process.env.COMET_REVIEW_MODE ?? await projectConfigValue2("review_mode") ?? "standard";
  if (!["null", "off", "standard", "thorough"].includes(value)) {
    fail2(`ERROR: Invalid review_mode: '${value}'
Valid values: off, standard, thorough`);
  }
  return value === "null" ? null : value;
}
function gitOutput(args) {
  const result5 = spawnSync3("git", args, { encoding: "utf8" });
  return result5.status === 0 ? result5.stdout.trim() : null;
}
async function stateFile(name) {
  const change = await changeDirectory2(name);
  await inspectClassicProjectTarget(
    classicCommandProjectRoot(),
    path31.join(change.directory, ".comet"),
    {
      label: `Classic runtime directory for ${name}`,
      expected: "directory"
    }
  );
  return {
    ...change,
    file: path31.join(change.directory, ".comet.yaml")
  };
}
async function readField3(name, field2) {
  const { file } = await stateFile(name);
  const document = await readDocument2(file);
  const record2 = document.toJS();
  const value = record2[field2];
  if (field2 === "language") {
    if (value === null || value === void 0 || value === "") return projectLanguageDefault();
    return validateLanguage(scalar(value), ".comet.yaml");
  }
  if (field2 === "auto_transition" && (value === null || value === void 0 || value === "")) {
    return autoTransition();
  }
  return scalar(value);
}
function parsedValue(field2, value) {
  const document = (0, import_yaml9.parseDocument)(`${field2}: ${value}
`);
  if (document.errors.length > 0) fail2(`ERROR: Invalid value: '${value}'`);
  return document.get(field2);
}
async function validateSetValue(field2, value) {
  if (field2 === "language") {
    validateLanguage(value, "language");
    return;
  }
  const enumValues = FIELD_ENUMS[field2];
  if (enumValues) validateEnum(value, enumValues);
  if (PATH_FIELDS.has(field2)) {
    validateRelativePath(value, field2);
    if (value && value !== "null") {
      await inspectClassicProjectTarget(classicCommandProjectRoot(), value, {
        label: `${field2} artifact pointer`,
        expected: "file"
      });
    }
  }
  if ((field2 === "skill_hash" || field2 === "handoff_hash") && !/^[a-f0-9]{64}$/u.test(value)) {
    fail2(`ERROR: ${field2} must be a sha256 hex digest`);
  }
  if (field2 === "iteration" && !/^[0-9]+$/u.test(value)) {
    fail2("ERROR: iteration must be a non-negative integer");
  }
}
async function setField2(output, name, field2, value, options = {}) {
  if (MACHINE_OWNED_FIELDS.has(field2) && !options.machineOwned) {
    fail2(`ERROR: '${field2}' is a machine-owned field and cannot be set directly`);
  }
  if (!SETTABLE_FIELDS.has(field2) && !MACHINE_OWNED_FIELDS.has(field2)) {
    fail2(`ERROR: Unknown field: '${field2}'`);
  }
  if (field2 === "phase" && !options.internal && process.env.COMET_FORCE_PHASE !== "1") {
    fail2(
      "ERROR: Setting 'phase' directly is not allowed; it bypasses state machine evidence checks.\n  Use: comet-state.mjs transition <change-name> <event>\n  Repair-only escape hatch: COMET_FORCE_PHASE=1 comet-state.mjs set <change-name> phase <value>"
    );
  }
  await validateSetValue(field2, value);
  const { file, directory } = await stateFile(name);
  const document = await readDocument2(file);
  const previousRecord = document.toJS() ?? {};
  document.set(field2, parsedValue(field2, value));
  if (field2 === "isolation") {
    if (requiresBranchBinding(value)) {
      const previousIsolation = typeof previousRecord.isolation === "string" ? previousRecord.isolation : null;
      const existing = previousRecord.bound_branch;
      const alreadyBound = typeof existing === "string" && existing !== "";
      if (!alreadyBound || previousIsolation !== value) {
        const invocationCwd = classicCommandInvocationCwd();
        const currentBranch = liveGitBranch(invocationCwd);
        const verdict = evaluateBranchBinding({
          isolation: value,
          boundBranch: null,
          currentBranch,
          gitWorkTree: currentBranch === null ? isGitWorkTree(invocationCwd) : true
        });
        if (verdict.status === "needs-heal") {
          document.set("bound_branch", verdict.branch);
        } else if (verdict.status === "unbound-detached") {
          fail2(
            `ERROR: cannot bind isolation=${value} while HEAD is detached; checkout a branch first`
          );
        } else {
          document.set("bound_branch", null);
        }
      }
    } else {
      document.set("bound_branch", null);
    }
  }
  const run = await readRunState(directory);
  const projection = parseClassicStateDocument(document.toJS(), run);
  if (projection.run) {
    if (!projection.classic) fail2("ERROR: migrated Run is missing its Classic projection");
    const evidence = await collectClassicEvidence(directory, projection);
    const currentStep = resolveClassicStepId(projection.classic, evidence);
    const stepChanged = currentStep !== projection.run.currentStep;
    const run2 = {
      ...projection.run,
      currentStep,
      iteration: projection.run.iteration + (stepChanged ? 1 : 0),
      status: currentStep === "completed" ? "completed" : "running"
    };
    await writeClassicState(directory, {
      classic: projection.classic,
      run: run2,
      unknownKeys: projection.unknownKeys
    });
    if (stepChanged) {
      const trajectory = await readTrajectory(directory, run2.trajectoryRef);
      await appendTrajectory(directory, run2.trajectoryRef, {
        sequence: trajectory.length + 1,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        type: "state_transitioned",
        runId: run2.runId,
        data: {
          kind: "classic-config",
          field: field2,
          fromStep: projection.run.currentStep,
          toStep: currentStep
        }
      });
    }
  } else {
    await atomicWrite(file, document.toString());
  }
  if (field2 === "phase" && !options.internal) {
    output.stderr.push(
      yellow4("WARNING: Setting 'phase' directly bypasses state machine constraints."),
      yellow4("  Consider using: comet-state.mjs transition <change-name> <event>")
    );
  }
  output.stderr.push(green4(`[SET] ${field2}=${value}`));
}
async function init(output, name, workflow) {
  validateChangeName4(name);
  validateEnum(workflow, PROFILES);
  const change = await ensureClassicActiveChangeDirectory(name, classicCommandProjectRoot());
  const { label, directory } = change;
  const file = path31.join(directory, ".comet.yaml");
  if (await exists2(file)) fail2(`ERROR: .comet.yaml already exists at ${label}/.comet.yaml`);
  const preset = workflow !== "full";
  const reviewMode = preset ? "off" : await reviewModeDefault();
  const document = new import_yaml9.Document({
    workflow,
    language: await projectLanguageDefault(),
    phase: "open",
    context_compression: await contextCompression(),
    build_mode: preset ? "direct" : null,
    build_pause: null,
    subagent_dispatch: null,
    tdd_mode: preset ? "direct" : null,
    review_mode: reviewMode,
    isolation: null,
    verify_mode: preset ? "light" : null,
    auto_transition: await autoTransition() === "true",
    base_ref: gitOutput(["rev-parse", "--verify", "HEAD"]),
    design_doc: null,
    plan: null,
    verify_result: "pending",
    verify_failures: 0,
    verification_report: null,
    branch_status: "pending",
    created_at: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
    verified_at: null,
    archive_confirmation: null,
    archived: false
  });
  await atomicWrite(file, document.toString());
  output.stdout.push(green4(`Initialized: ${label}/.comet.yaml (workflow=${workflow})`));
}
async function requirePhase(name, expected) {
  const actual = await readField3(name, "phase");
  if (actual !== expected) {
    fail2(`ERROR: Cannot transition '${name}': expected phase ${expected}, got ${actual}`);
  }
}
async function requireBuildDecisions(name) {
  const workflow = await readField3(name, "workflow");
  const buildMode = await readField3(name, "build_mode");
  const isolation = await readField3(name, "isolation");
  const directOverride = await readField3(name, "direct_override");
  const subagentDispatch = await readField3(name, "subagent_dispatch");
  const tddMode = await readField3(name, "tdd_mode");
  const reviewMode = await readField3(name, "review_mode");
  const allowedIsolation = ["current", "branch", "worktree"];
  if (!allowedIsolation.includes(isolation)) {
    fail2(
      `ERROR: Cannot transition '${name}': isolation must be current, branch, or worktree, got '${isolation || "null"}'`
    );
  }
  if (!["subagent-driven-development", "executing-plans", "direct"].includes(buildMode)) {
    fail2(
      `ERROR: Cannot transition '${name}': build_mode must be selected before leaving build, got '${buildMode || "null"}'`
    );
  }
  if (buildMode === "direct" && !["hotfix", "tweak"].includes(workflow) && directOverride !== "true") {
    fail2(
      `ERROR: Cannot transition '${name}': build_mode=direct is only allowed for hotfix/tweak unless direct_override=true`
    );
  }
  if (buildMode === "subagent-driven-development" && subagentDispatch !== "confirmed") {
    fail2(
      `ERROR: Cannot transition '${name}': subagent_dispatch must be confirmed before using build_mode=subagent-driven-development`
    );
  }
  if (workflow === "full" && (!tddMode || tddMode === "null")) {
    fail2(
      `ERROR: Cannot transition '${name}': tdd_mode must be selected before leaving build (full workflow)`
    );
  }
  if (workflow === "full" && !["off", "standard", "thorough"].includes(reviewMode)) {
    fail2(
      `ERROR: Cannot transition '${name}': review_mode must be selected before leaving build (full workflow); review_mode must be off, standard, or thorough, got '${reviewMode || "null"}'`
    );
  }
}
async function requireOpenArtifacts(name) {
  const { directory } = await stateFile(name);
  const workflow = await readField3(name, "workflow");
  for (const artifact of ["proposal.md", "tasks.md"]) {
    if (!await nonempty2(path31.join(directory, artifact))) {
      fail2(
        `ERROR: Cannot transition '${name}': ${artifact} must exist and be non-empty before leaving open`
      );
    }
  }
  if (workflow === "full" && !await nonempty2(path31.join(directory, "design.md"))) {
    fail2(
      `ERROR: Cannot transition '${name}': design.md must exist and be non-empty before leaving open`
    );
  }
}
async function requireDesignEvidence(name) {
  const designDoc = await readField3(name, "design_doc");
  if (!designDoc || designDoc === "null" || !await nonempty2(path31.resolve(designDoc))) {
    fail2(
      `ERROR: Cannot transition '${name}': design_doc must point to an existing Design Doc before leaving design`
    );
  }
}
async function writeSparseTransitionEffects(directory, effects) {
  const file = path31.join(directory, ".comet.yaml");
  const document = await readDocument2(file);
  for (const effect of effects) {
    const field2 = wireField2(effect.field);
    document.set(field2, parsedValue(field2, wireValue2(effect.to)));
  }
  await atomicWrite(file, document.toString());
}
async function applyTransitionEvent(output, name, event) {
  const { directory } = await stateFile(name);
  const projection = await readClassicState(directory);
  let classic = projection.classic;
  let sparse = false;
  if (!classic) {
    if (projection.run) fail2("ERROR: Classic state projection is missing");
    const document = await readDocument2(path31.join(directory, ".comet.yaml"));
    classic = sparseClassicState(document.toJS());
    sparse = true;
  }
  const result5 = applyClassicTransition(classic, event);
  if (projection.run) {
    await transitionClassicRuntimeRun(directory, result5.classic, projection.run, {
      event,
      source: "comet-state"
    });
  } else if (sparse) {
    await writeSparseTransitionEffects(directory, result5.effects);
  } else {
    await writeClassicState(directory, {
      classic: result5.classic,
      run: null,
      unknownKeys: projection.unknownKeys
    });
  }
  await appendClassicStateEvent(directory, {
    change: name,
    event,
    source: "comet-state",
    from: classic,
    to: result5.classic,
    effects: result5.effects
  });
  for (const effect of result5.effects) {
    output.stderr.push(green4(`[SET] ${wireField2(effect.field)}=${wireValue2(effect.to)}`));
  }
  output.stderr.push(green4(`[TRANSITION] ${event}`));
}
async function transition(output, name, event) {
  validateChangeName4(name);
  validateEnum(event, EVENTS);
  if (event === "open-complete") {
    await requirePhase(name, "open");
    await requireOpenArtifacts(name);
  } else if (event === "design-complete") {
    await requirePhase(name, "design");
    await requireDesignEvidence(name);
  } else if (event === "build-complete") {
    await requirePhase(name, "build");
    await requireBuildDecisions(name);
  } else if (event === "verify-pass") {
    await requirePhase(name, "verify");
    const report = await readField3(name, "verification_report");
    if (!report || !await exists2(path31.resolve(report))) {
      fail2(
        `ERROR: Cannot transition '${name}': verification_report must point to an existing report file`
      );
    }
  } else if (event === "verify-fail") {
    await requirePhase(name, "verify");
  } else if (event === "archive-confirm") {
    await requirePhase(name, "archive");
    if (await readField3(name, "verify_result") !== "pass") {
      fail2(`ERROR: Cannot transition '${name}': verify_result must be pass before archiving`);
    }
    if (await readField3(name, "archived") === "true") {
      fail2(`ERROR: Cannot transition '${name}': already archived`);
    }
  } else if (event === "preset-escalate") {
    await requirePhase(name, "build");
    const workflow = await readField3(name, "workflow");
    if (!["hotfix", "tweak"].includes(workflow)) {
      fail2(
        `ERROR: Cannot transition '${name}': preset-escalate only applies to hotfix/tweak, got workflow='${workflow}'`
      );
    }
  } else if (event === "archive-reopen") {
    await requirePhase(name, "archive");
    if (await readField3(name, "archived") === "true") {
      fail2(`ERROR: Cannot transition '${name}': already archived`);
    }
  } else {
    await requirePhase(name, "archive");
    if (await readField3(name, "verify_result") !== "pass") {
      fail2(`ERROR: Cannot transition '${name}': verify_result must be pass before archiving`);
    }
    if (await readField3(name, "archive_confirmation") !== "confirmed") {
      fail2(
        `ERROR: Cannot transition '${name}': archive_confirmation must be confirmed before archiving`
      );
    }
  }
  await applyTransitionEvent(output, name, event);
}
async function next(output, name) {
  validateChangeName4(name);
  const { file, label } = await stateFile(name);
  if (!await exists2(file)) fail2(`ERROR: .comet.yaml not found at ${label}/.comet.yaml`);
  const phase = await readField3(name, "phase");
  const workflow = await readField3(name, "workflow");
  const automatic = await readField3(name, "auto_transition");
  if (await readField3(name, "archived") === "true") {
    output.stdout.push("NEXT: done");
    return;
  }
  const skill = phase === "open" ? "comet-open" : phase === "design" ? "comet-design" : phase === "verify" ? "comet-verify" : phase === "archive" ? "comet-archive" : phase === "build" ? workflow === "hotfix" ? "comet-hotfix" : workflow === "tweak" ? "comet-tweak" : "comet-build" : null;
  if (!skill) {
    fail2(`ERROR: Cannot resolve next step for '${name}': unknown phase '${phase || "null"}'`);
  }
  output.stdout.push(`NEXT: ${automatic === "false" ? "manual" : "auto"}`, `SKILL: ${skill}`);
  if (automatic === "false") {
    output.stdout.push(`HINT: phase is '${phase}'; run /${skill} manually to continue`);
  }
}
async function taskCheckoff(output, taskFile, taskText) {
  validateRelativePath(taskFile, "task file");
  if (!taskText) fail2("ERROR: Task text cannot be empty");
  const file = path31.resolve(classicCommandProjectRoot(), taskFile);
  if (!await exists2(file)) fail2(`ERROR: Task file not found: ${taskFile}`);
  const lines = (await readClassicProjectFile(classicCommandProjectRoot(), file, {
    label: "Classic task-checkoff file"
  })).split(/\r?\n/u);
  const matches = lines.filter(
    (line) => [`- [ ] ${taskText}`, `- [x] ${taskText}`, `- [X] ${taskText}`].includes(line)
  );
  const checked = matches.filter((line) => /^- \[[xX]\] /u.test(line));
  if (matches.length !== 1) {
    fail2(
      `ERROR: task text must appear exactly once in ${taskFile} (found ${matches.length}): ${taskText}`
    );
  }
  if (checked.length !== 1) fail2(`ERROR: task is not checked in ${taskFile}: ${taskText}`);
  output.stdout.push("TASK_CHECKOFF: PASS", `FILE: ${taskFile}`, `TASK: ${taskText}`);
}
async function check2(output, name, phase) {
  validateChangeName4(name);
  validateEnum(phase, PHASES3);
  const { file, directory, label } = await stateFile(name);
  output.stdout.push(`=== Entry Check: comet-${phase} ===`);
  if (!await exists2(file)) fail2(`ERROR: .comet.yaml not found at ${label}/.comet.yaml`);
  let blocked2 = false;
  const pass2 = (message) => output.stdout.push(`  ${green4("[PASS]")} ${message}`);
  const reject = (message) => {
    output.stdout.push(`  ${red4("[FAIL]")} ${message}`);
    blocked2 = true;
  };
  const expectField = async (field2, expected) => {
    const actual = await readField3(name, field2);
    (actual === expected ? pass2 : reject)(`${field2}=${actual} (expected: ${expected})`);
  };
  pass2(".comet.yaml exists");
  await expectField("phase", phase);
  if (phase === "design") {
    await expectField("workflow", "full");
    const designDoc = await readField3(name, "design_doc");
    (!designDoc || designDoc === "null" ? pass2 : reject)(
      designDoc ? `design_doc=${designDoc} (expected: empty/null)` : "design_doc is empty/null"
    );
    for (const artifact of ["proposal.md", "design.md", "tasks.md"]) {
      (await nonempty2(path31.join(directory, artifact)) ? pass2 : reject)(
        `${artifact} ${await nonempty2(path31.join(directory, artifact)) ? "non-empty" : "missing or empty"}`
      );
    }
  } else if (phase === "build") {
    const workflow = await readField3(name, "workflow");
    const designDoc = await readField3(name, "design_doc");
    if (workflow === "full") {
      (designDoc && designDoc !== "null" && await exists2(path31.resolve(designDoc)) ? pass2 : reject)(`design_doc=${designDoc} (expected: non-null and file exists)`);
    } else {
      pass2(`workflow=${workflow} (design_doc not required)`);
    }
    for (const artifact of ["proposal.md", "tasks.md"]) {
      (await nonempty2(path31.join(directory, artifact)) ? pass2 : reject)(
        `${artifact} ${await nonempty2(path31.join(directory, artifact)) ? "non-empty" : "missing or empty"}`
      );
    }
  } else if (phase === "verify") {
    const value = await readField3(name, "verify_result");
    (["", "null", "pending"].includes(value) ? pass2 : reject)(
      `verify_result=${value} (expected: pending or null)`
    );
  } else if (phase === "archive") {
    await expectField("verify_result", "pass");
    const archived = await readField3(name, "archived");
    (archived !== "true" ? pass2 : reject)(`archived=${archived} (expected: not true)`);
  }
  const binding = await resolveBranchBinding(directory, {
    heal: true,
    cwd: classicCommandInvocationCwd()
  });
  if (binding.bindingRequired) {
    switch (binding.status) {
      case "drift":
        reject(driftBlockedMessage(name, binding.boundBranch, binding.currentBranch));
        break;
      case "unbound-detached":
        reject(unboundDetachedMessage(name));
        break;
      case "healed":
        pass2(`bound_branch lazily set to ${binding.branch}`);
        break;
      case "needs-heal":
      case "ok":
      case "not-applicable":
        pass2("bound_branch matches current branch");
        break;
      default: {
        const exhaustive = binding;
        throw new Error(`unhandled branch binding status: ${JSON.stringify(exhaustive)}`);
      }
    }
  }
  output.stdout.push("");
  if (blocked2) {
    output.stderr.push(red4("BLOCKED — fix failing checks before proceeding"));
    throw new CommandFailure("", 1);
  }
  output.stderr.push(green4("ALL CHECKS PASSED — ready to proceed"));
}
async function fieldStatus(field2, value, file) {
  if (!value || value === "null") return `  - ${field2}: PENDING`;
  if (file && !await exists2(path31.resolve(file))) {
    return `  - ${field2}: BROKEN (path ${value} does not exist)`;
  }
  return `  - ${field2}: DONE (${value})`;
}
async function recoverOpen(output, directory) {
  output.stdout.push("  Artifacts:");
  let complete = 0;
  for (const artifact of ["proposal.md", "design.md", "tasks.md"]) {
    const done = await nonempty2(path31.join(directory, artifact));
    if (done) complete += 1;
    output.stdout.push(`  - ${artifact}: ${done ? "DONE" : "PENDING"}`);
  }
  output.stdout.push(
    "",
    complete === 3 ? "Recovery action: All artifacts complete. Run /comet-open user confirmation, then guard to transition." : complete === 0 ? "Recovery action: No artifacts created yet. Start from /comet-open Step 1 (explore and clarify)." : "Recovery action: Some artifacts incomplete. Resume /comet-open from the first missing artifact."
  );
}
async function recoverDesign(output, name, directory) {
  output.stdout.push("  Artifacts:");
  for (const artifact of ["proposal.md", "design.md", "tasks.md"]) {
    output.stdout.push(
      `  - ${artifact}: ${await nonempty2(path31.join(directory, artifact)) ? "DONE" : "MISSING (unexpected in design phase)"}`
    );
  }
  const handoff = await readField3(name, "handoff_context");
  const hash = await readField3(name, "handoff_hash");
  const design = await readField3(name, "design_doc");
  output.stdout.push(
    "",
    "  Design progress:",
    await fieldStatus("handoff_context", handoff, handoff),
    await fieldStatus("handoff_hash", hash),
    await fieldStatus("design_doc", design, design),
    ""
  );
  if (design && design !== "null" && await exists2(path31.resolve(design))) {
    output.stdout.push(
      "Recovery action: Design Doc already created and linked. Run guard to transition to build."
    );
  } else if (handoff && handoff !== "null" && await exists2(path31.resolve(handoff))) {
    output.stdout.push(
      "Recovery action: Handoff generated but Design Doc not yet created. Resume from brainstorming confirmation (Step 1c)."
    );
  } else {
    output.stdout.push(
      "Recovery action: No handoff generated yet. Start from Step 1a (generate handoff package)."
    );
  }
}
async function recoverBuild(output, name, directory, workflow) {
  const isolation = await readField3(name, "isolation");
  const buildMode = await readField3(name, "build_mode");
  const pause = await readField3(name, "build_pause");
  const subagentDispatch = await readField3(name, "subagent_dispatch");
  const tdd = await readField3(name, "tdd_mode");
  const review = await readField3(name, "review_mode");
  const plan = await readField3(name, "plan");
  const decisions = [
    "  Build decisions:",
    await fieldStatus("isolation", isolation),
    await fieldStatus("build_mode", buildMode),
    await fieldStatus("build_pause", pause),
    await fieldStatus("tdd_mode", tdd),
    await fieldStatus("review_mode", review)
  ];
  if (buildMode === "subagent-driven-development" || subagentDispatch && subagentDispatch !== "null") {
    decisions.push(await fieldStatus("subagent_dispatch", subagentDispatch));
  }
  output.stdout.push(...decisions, "", "  Plan:", await fieldStatus("plan", plan, plan), "");
  const tasks = path31.join(directory, "tasks.md");
  if (!await exists2(tasks)) {
    output.stdout.push(
      "  Tasks: tasks.md MISSING",
      "",
      "Recovery action: tasks.md missing. Verify change directory integrity."
    );
    return;
  }
  const lines = (await readClassicProjectFile(classicCommandProjectRoot(), tasks, {
    label: "Classic change tasks"
  })).split(/\r?\n/u);
  const total = lines.filter((line) => /^\s*- \[[ xX]\] /u.test(line)).length;
  const done = lines.filter((line) => /^\s*- \[[xX]\] /u.test(line)).length;
  const pending = total - done;
  let planTotal = 0;
  let planDone = 0;
  if (plan && plan !== "null" && await exists2(plan)) {
    const planLines = (await readClassicProjectFile(classicCommandProjectRoot(), plan, {
      label: "Classic build plan"
    })).split(/\r?\n/u);
    planTotal = planLines.filter((line) => /^\s*- \[[ xX]\] /u.test(line)).length;
    planDone = planLines.filter((line) => /^\s*- \[[xX]\] /u.test(line)).length;
  }
  const planPending = planTotal - planDone;
  output.stdout.push(`  Tasks: ${done}/${total} done, ${pending} pending`);
  if (planTotal > 0) {
    output.stdout.push(`  Plan tasks: ${planDone}/${planTotal} done, ${planPending} pending`);
  }
  output.stdout.push("");
  const action = resolveBuildRecoveryAction(
    workflow,
    isolation,
    buildMode,
    pause,
    subagentDispatch,
    tdd,
    review,
    plan,
    pending,
    planPending
  );
  output.stdout.push(action);
}
function isMissingStateValue(value) {
  return !value || value === "null";
}
function resolveBuildRecoveryAction(workflow, isolation, buildMode, pause, subagentDispatch, tdd, review, plan, pending, planPending) {
  const planExists = plan && plan !== "null";
  const missingWorkflowChoices = workflow === "full" && (isMissingStateValue(tdd) || isMissingStateValue(review));
  if (pause === "plan-ready" && planExists && (isMissingStateValue(isolation) || isMissingStateValue(buildMode) || missingWorkflowChoices)) {
    return workflow === "full" ? "Recovery action: Plan-ready pause detected. Ask the user whether to continue, then choose isolation, build mode, TDD mode, and review mode without regenerating the plan." : "Recovery action: Plan-ready pause detected. Ask the user whether to continue, then choose isolation and build mode without regenerating the plan.";
  }
  if (pause === "plan-ready" && !planExists) {
    return "Recovery action: Plan-ready pause is recorded, but the plan file is missing. Restore the plan file or rerun writing-plans before choosing execution.";
  }
  if (pause === "plan-ready") {
    if (buildMode === "subagent-driven-development" && (pending > 0 || planPending > 0)) {
      return subagentDispatch === "confirmed" ? "Recovery action: Plan-ready pause is stale because build decisions are already selected. Clear build_pause to null, then inspect the first unchecked task (OpenSpec or plan additions) against recent git history/diff. If implemented, check it off; otherwise dispatch a real background subagent. Do not execute the pending task directly in the main window." : "Recovery action: Plan-ready pause is stale and subagent dispatch is not confirmed. Return to /comet-build Step 2 capability preflight. Confirm a real background subagent/Task/multi-agent dispatcher and set subagent_dispatch to confirmed, or remove the unavailable mode and set build_mode to executing-plans before continuing.";
    }
    if (pending > 0 || planPending > 0) {
      return "Recovery action: Plan-ready pause is stale because build decisions are already selected. Clear build_pause to null, then continue from the first unchecked task.";
    }
    return "Recovery action: Plan-ready pause is stale and all tasks are done. Clear build_pause to null, then run guard to transition to verify.";
  }
  if (isMissingStateValue(isolation)) {
    return "Recovery action: Isolation not selected. Use the current platform's user confirmation mechanism to ask user for branch/worktree choice.";
  }
  if (isMissingStateValue(buildMode)) {
    return "Recovery action: Build mode not selected. Use the current platform's user confirmation mechanism to ask user for execution method.";
  }
  if (workflow === "full" && isMissingStateValue(tdd)) {
    return "Recovery action: TDD mode not selected. Use the current platform's user confirmation mechanism to ask user for tdd or direct.";
  }
  if (workflow === "full" && isMissingStateValue(review)) {
    return "Recovery action: Review mode not selected. Use the current platform's user confirmation mechanism to ask user for off, standard, or thorough.";
  }
  if (pending > 0) {
    if (buildMode === "subagent-driven-development") {
      return subagentDispatch === "confirmed" ? "Recovery action: Read tasks.md and the Superpowers plan (which may include additions beyond OpenSpec), then inspect the first unchecked task against recent git history/diff. If implemented, check it off; otherwise dispatch a real background subagent. Do not execute the pending task directly in the main window." : "Recovery action: Subagent dispatch is not confirmed. Return to /comet-build Step 2 capability preflight. Confirm a real background subagent/Task/multi-agent dispatcher and set subagent_dispatch to confirmed, or remove the unavailable mode and set build_mode to executing-plans before continuing.";
    }
    return "Recovery action: Read tasks.md and continue from first unchecked task.";
  }
  if (planPending > 0) {
    if (buildMode === "subagent-driven-development") {
      return subagentDispatch === "confirmed" ? "Recovery action: Read the Superpowers plan, then inspect the first unchecked Superpowers plan task against recent git history/diff. If implemented, check it off; otherwise dispatch a real background subagent. Do not execute the pending task directly in the main window." : "Recovery action: Subagent dispatch is not confirmed. Return to /comet-build Step 2 capability preflight. Confirm a real background subagent/Task/multi-agent dispatcher and set subagent_dispatch to confirmed, or remove the unavailable mode and set build_mode to executing-plans before continuing.";
    }
    return "Recovery action: Read the Superpowers plan and continue from the first unchecked plan task.";
  }
  return "Recovery action: All tasks done. Run guard to transition to verify.";
}
async function recoverVerify(output, name) {
  const result5 = await readField3(name, "verify_result");
  const failures = await readField3(name, "verify_failures");
  const mode = await readField3(name, "verify_mode");
  const report = await readField3(name, "verification_report");
  const branch = await readField3(name, "branch_status");
  output.stdout.push(
    "  Verification:",
    await fieldStatus("verify_result", result5),
    `  - verify_failures: ${failures || "0"}`,
    await fieldStatus("verify_mode", mode),
    await fieldStatus("verification_report", report, report),
    branch === "handled" ? "  - branch_status: LEGACY (handled before archive; archive still owns final closure)" : "  - branch_status: DEFERRED (handled after the archive commit)",
    "",
    result5 === "pass" ? "Recovery action: Verification complete. Continue to archive; branch handling happens after archive changes are committed." : result5 === "fail" ? "Recovery action: Verification failed and rolled back to build. Resume from /comet-build." : "Recovery action: Verification not yet started or in progress. Run scale assessment then verify."
  );
}
async function recoverArchive(output, name) {
  const archiveConfirmation = await readField3(name, "archive_confirmation");
  output.stdout.push(
    "  Archive:",
    await fieldStatus("verify_result", await readField3(name, "verify_result")),
    await fieldStatus("archive_confirmation", archiveConfirmation),
    await fieldStatus("archived", await readField3(name, "archived")),
    "",
    archiveConfirmation === "confirmed" ? "Recovery action: Archive is confirmed. Run /comet-archive to complete archiving." : "Recovery action: Ask for final archive confirmation in /comet-archive before running the archive command."
  );
}
async function recover(output, name) {
  validateChangeName4(name);
  const { file, directory, label } = await stateFile(name);
  if (!await exists2(file)) fail2(`ERROR: .comet.yaml not found at ${label}/.comet.yaml`);
  const phase = await readField3(name, "phase");
  const workflow = await readField3(name, "workflow");
  output.stdout.push(
    `=== Recovery Context: ${name} ===`,
    `Phase: ${phase}`,
    `Workflow: ${workflow}`,
    "",
    "State fields:"
  );
  if (phase === "open") {
    await recoverOpen(output, directory);
  } else if (phase === "design") {
    await recoverDesign(output, name, directory);
  } else if (phase === "build") {
    await recoverBuild(output, name, directory, workflow);
  } else if (phase === "verify") {
    await recoverVerify(output, name);
  } else if (phase === "archive") {
    await recoverArchive(output, name);
  } else {
    fail2(`ERROR: Unknown phase: ${phase}`);
  }
  output.stdout.push("", "=== End Recovery Context ===");
}
async function scale(output, name) {
  validateChangeName4(name);
  const { file, directory, label } = await stateFile(name);
  if (!await exists2(file)) fail2(`ERROR: .comet.yaml not found at ${label}/.comet.yaml`);
  const tasksFile = path31.join(directory, "tasks.md");
  const taskCount = await exists2(tasksFile) ? (await readClassicProjectFile(classicCommandProjectRoot(), tasksFile, {
    label: "Classic scale task file"
  })).split(/\r?\n/u).filter((line) => /^- \[/u.test(line)).length : 0;
  const specs = path31.join(directory, "specs");
  let deltaSpecs = 0;
  if (await exists2(specs)) {
    for (const entry2 of await fs22.readdir(specs)) {
      if (await exists2(path31.join(specs, entry2, "spec.md"))) deltaSpecs += 1;
    }
  }
  const plan = await readField3(name, "plan");
  let baseRef = "";
  if (plan && plan !== "null" && await exists2(plan)) {
    const match = (await readClassicProjectFile(classicCommandProjectRoot(), plan, {
      label: "Classic scale plan"
    })).match(/^base-ref:\s*(.+)$/mu);
    baseRef = match?.[1].trim() ?? "";
  }
  if (!baseRef) baseRef = await readField3(name, "base_ref");
  const changed = gitOutput([
    "diff",
    "--name-only",
    ...baseRef && baseRef !== "null" ? [`${baseRef}...HEAD`] : ["HEAD"]
  ]);
  const changedFiles = changed ? changed.split(/\r?\n/u).filter(Boolean).length : 0;
  const result5 = taskCount > 3 || deltaSpecs > 1 || changedFiles > 8 ? "full" : "light";
  await setField2(new CommandOutput(), name, "verify_mode", result5);
  output.stderr.push(
    `=== Scale Assessment: ${name} ===`,
    `  Tasks: ${taskCount} (threshold: 3)`,
    `  Delta specs: ${deltaSpecs} capabilities (threshold: 1)`,
    `  Changed files: ${changedFiles} (threshold: 8)`,
    `  → Result: ${result5}`,
    green4(`[SCALE] verify_mode=${result5}`)
  );
}
function parseRecordCheckOptions(args) {
  let command;
  let exitCodeText;
  let cwd;
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    if (!["--command", "--exit-code", "--cwd"].includes(option)) {
      fail2(`ERROR: Unknown option: ${option}`);
    }
    const value = args[index + 1];
    if (value === void 0) fail2(`ERROR: Missing value for option: ${option}`);
    if (option === "--command") command = value;
    else if (option === "--exit-code") exitCodeText = value;
    else cwd = value;
  }
  if (command === void 0) fail2("ERROR: Missing option: --command");
  if (exitCodeText === void 0) fail2("ERROR: Missing option: --exit-code");
  if (!/^-?\d+$/u.test(exitCodeText)) fail2("ERROR: --exit-code must be an integer");
  return { command, exitCode: Number(exitCodeText), ...cwd === void 0 ? {} : { cwd } };
}
async function recordCheck(output, name, scopeText, args) {
  validateChangeName4(name);
  if (scopeText !== "build" && scopeText !== "verify") {
    fail2(`ERROR: Invalid command check scope: '${scopeText}'`);
  }
  const options = parseRecordCheckOptions(args);
  const { directory, file } = await stateFile(name);
  const projectRoot = classicCommandProjectRoot();
  const activeChangesDir = (await assertClassicLayoutReadable(projectRoot)).changesDir;
  if (path31.dirname(directory) !== activeChangesDir || !await exists2(file)) {
    fail2(`ERROR: command checks require an active change: ${name}`);
  }
  try {
    const projection = await readClassicState(directory, { migrate: false });
    if (!projection.classic || !projection.run) {
      throw new Error("command checks require an existing synchronized Classic Run");
    }
    const { run } = await validateClassicRuntimeRun(directory, projection);
    const recorded = await recordCommandCheck(projectRoot, directory, run, {
      scope: scopeText,
      ...options,
      cwd: options.cwd ?? (path31.relative(projectRoot, classicCommandInvocationCwd()).replaceAll("\\", "/") || ".")
    });
    output.stderr.push(
      green4(
        `[RECORDED] ${recorded.scope} exit=${recorded.exitCode} cwd=${recorded.cwd} command=${recorded.command}`
      )
    );
  } catch (error) {
    fail2(`ERROR: ${error.message}`);
  }
}
function required(args, count, usage4) {
  if (args.length < count) fail2(usage4);
}
function requiredExact(args, count, usage4) {
  if (args.length !== count) fail2(usage4);
}
var MUTATING_STATE_COMMANDS = /* @__PURE__ */ new Set([
  "init",
  "set",
  "transition",
  "check",
  "scale",
  "record-check",
  "rebind",
  "select",
  "clear-selection"
]);
async function assertStateCommandWritable(subcommand) {
  if (!subcommand || !MUTATING_STATE_COMMANDS.has(subcommand)) return;
  try {
    await assertClassicLayoutWritable(classicCommandProjectRoot());
  } catch (error) {
    fail2(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function selectChange(output, name) {
  validateChangeName4(name);
  try {
    const selection = await selectCurrentChange(classicCommandProjectRoot(), name);
    const boundBranch = await readField3(name, "bound_branch");
    const bound = boundBranch && boundBranch !== "null" ? boundBranch : null;
    output.stderr.push(
      green4(`[SELECTED] current change: ${selection.change}${bound ? ` (branch: ${bound})` : ""}`)
    );
  } catch (error) {
    fail2(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function rebind(output, name) {
  validateChangeName4(name);
  const { directory } = await stateFile(name);
  const boundBranch = await readField3(name, "bound_branch");
  if (!boundBranch || boundBranch === "null") {
    fail2(
      `ERROR: '${name}' is not yet bound; use 'comet state set ${name} isolation <current|branch|worktree>' to establish the first binding`
    );
  }
  const branch = liveGitBranch(classicCommandInvocationCwd());
  if (branch === null) {
    fail2("ERROR: cannot rebind while HEAD is detached; checkout a branch first");
  }
  const before = await readClassicState(directory);
  if (!before.classic) fail2("ERROR: Classic state projection is missing");
  await healBoundBranch(directory, branch);
  const after = { ...before.classic, boundBranch: branch };
  await appendClassicStateEvent(directory, {
    change: name,
    event: "rebind",
    source: "comet-state",
    from: before.classic,
    to: after,
    effects: [{ field: "boundBranch", from: boundBranch, to: branch }]
  });
  output.stderr.push(green4(`[REBIND] bound_branch: ${boundBranch} → ${branch}`));
}
async function currentChange(output) {
  const resolution = await resolveCurrentChange(classicCommandProjectRoot());
  if (resolution.status === "selected") {
    output.stdout.push(resolution.selection.change);
    return;
  }
  if (resolution.status === "missing") {
    fail2("ERROR: no current change selected\nUse: comet-state.mjs select <change-name>");
  }
  fail2(
    `ERROR: current change selection is stale: ${resolution.reason}
Use: comet-state.mjs select <change-name>`
  );
}
async function clearSelection(output) {
  await clearCurrentChange(classicCommandProjectRoot());
  output.stderr.push(green4("[CLEARED] current change selection"));
}
var classicStateCommand = async (args, options) => withClassicCommandContext(options, async () => {
  const output = new CommandOutput();
  try {
    const [subcommand, ...rest] = args;
    await assertStateCommandWritable(subcommand);
    if (subcommand === "init") {
      required(rest, 2, "Usage: comet-state.mjs init <change-name> <workflow>");
      await init(output, rest[0], rest[1]);
    } else if (subcommand === "get") {
      required(rest, 2, "Usage: comet-state.mjs get <change-name> <field>");
      validateChangeName4(rest[0]);
      output.stdout.push(await readField3(rest[0], rest[1]));
    } else if (subcommand === "set") {
      required(rest, 3, "Usage: comet-state.mjs set <change-name> <field> <value>");
      validateChangeName4(rest[0]);
      await setField2(output, rest[0], rest[1], rest[2]);
    } else if (subcommand === "transition") {
      required(rest, 2, "Usage: comet-state.mjs transition <change-name> <event>");
      await transition(output, rest[0], rest[1]);
    } else if (subcommand === "check") {
      required(rest, 2, "Usage: comet-state.mjs check <change-name> <phase> [--recover]");
      if (rest[2] === "--recover") await recover(output, rest[0]);
      else await check2(output, rest[0], rest[1]);
    } else if (subcommand === "scale") {
      required(rest, 1, "Usage: comet-state.mjs scale <change-name>");
      await scale(output, rest[0]);
    } else if (subcommand === "record-check") {
      required(
        rest,
        2,
        "Usage: comet state record-check <change> <build|verify> --command <text> --exit-code <int> [--cwd <path>]"
      );
      await recordCheck(output, rest[0], rest[1], rest.slice(2));
    } else if (subcommand === "task-checkoff") {
      required(rest, 2, "Usage: comet-state.mjs task-checkoff <file> <task-text>");
      await taskCheckoff(output, rest[0], rest[1]);
    } else if (subcommand === "rebind") {
      requiredExact(rest, 1, "Usage: comet-state.mjs rebind <change-name>");
      await rebind(output, rest[0]);
    } else if (subcommand === "select") {
      requiredExact(rest, 1, "Usage: comet-state.mjs select <change-name>");
      await selectChange(output, rest[0]);
    } else if (subcommand === "current") {
      requiredExact(rest, 0, "Usage: comet-state.mjs current");
      await currentChange(output);
    } else if (subcommand === "clear-selection") {
      requiredExact(rest, 0, "Usage: comet-state.mjs clear-selection");
      await clearSelection(output);
    } else if (subcommand === "next") {
      required(rest, 1, "Usage: comet-state.mjs next <change-name>");
      await next(output, rest[0]);
    } else {
      fail2(`Unknown subcommand: ${subcommand ?? ""}`);
    }
    return output.result();
  } catch (error) {
    if (!(error instanceof CommandFailure)) throw error;
    if (error.message) {
      for (const line of error.message.split("\n")) output.stderr.push(red4(line));
    }
    return output.result(error.exitCode);
  }
});

// domains/comet-classic/classic-cli.ts
var CLASSIC_COMMANDS = [
  "state",
  "validate",
  "guard",
  "handoff",
  "archive",
  "hook-guard",
  "intent",
  "resume-probe",
  "openspec",
  "root"
];
var DEFAULT_HANDLERS = {
  state: classicStateCommand,
  validate: classicValidateCommand,
  guard: classicGuardCommand,
  handoff: classicHandoffCommand,
  archive: classicArchiveCommand,
  "hook-guard": classicHookGuardCommand,
  intent: classicIntentCommand,
  "resume-probe": classicResumeProbeCommand,
  openspec: classicOpenSpecCommand,
  root: classicRootCommand
};
function isClassicCommand(value) {
  return CLASSIC_COMMANDS.includes(value);
}
function commandError(command) {
  if (!command) {
    return {
      exitCode: 64,
      stderr: `Usage: comet-classic <${CLASSIC_COMMANDS.join("|")}> [args]`
    };
  }
  return {
    exitCode: 64,
    stderr: `Unknown Classic command: ${command}`
  };
}
async function dispatch(command, args, options, handlers) {
  if (!command || !isClassicCommand(command)) return commandError(command);
  const handler = handlers[command];
  if (!handler) {
    return {
      exitCode: 70,
      stderr: `Classic command is not implemented: ${command}`
    };
  }
  try {
    return await handler(args, options);
  } catch (error) {
    return {
      exitCode: 70,
      stderr: error instanceof Error ? error.message : String(error)
    };
  }
}
function jsonResult(command, result5) {
  return {
    exitCode: result5.exitCode,
    stdout: JSON.stringify({
      command: command ?? null,
      exitCode: result5.exitCode,
      ...result5.stdout === void 0 ? {} : { stdout: result5.stdout },
      ...result5.stderr === void 0 ? {} : { stderr: result5.stderr }
    }) + "\n"
  };
}
async function runClassicCli(argv, handlers = DEFAULT_HANDLERS) {
  const json = argv[0] !== "openspec" && argv.includes("--json");
  const args = json ? argv.filter((argument) => argument !== "--json") : [...argv];
  const command = args.shift();
  const result5 = await dispatch(command, args, { json, invocationCwd: process.cwd() }, handlers);
  return json ? jsonResult(command, result5) : result5;
}
async function main(argv = process.argv.slice(2)) {
  const result5 = await runClassicCli(argv);
  if (result5.stdout) process.stdout.write(result5.stdout);
  if (result5.stderr)
    process.stderr.write(result5.stderr + (result5.stderr.endsWith("\n") ? "" : "\n"));
  return result5.exitCode;
}
var entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
export {
  CLASSIC_COMMANDS,
  main,
  runClassicCli
};
