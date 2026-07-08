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
    function visit_(key, node, visitor, path18) {
      const ctrl = callVisitor(key, node, visitor, path18);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path18, ctrl);
        return visit_(key, ctrl, visitor, path18);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path18 = Object.freeze(path18.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = visit_(i, node.items[i], visitor, path18);
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
          path18 = Object.freeze(path18.concat(node));
          const ck = visit_("key", node.key, visitor, path18);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = visit_("value", node.value, visitor, path18);
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
    async function visitAsync_(key, node, visitor, path18) {
      const ctrl = await callVisitor(key, node, visitor, path18);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path18, ctrl);
        return visitAsync_(key, ctrl, visitor, path18);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path18 = Object.freeze(path18.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = await visitAsync_(i, node.items[i], visitor, path18);
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
          path18 = Object.freeze(path18.concat(node));
          const ck = await visitAsync_("key", node.key, visitor, path18);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = await visitAsync_("value", node.value, visitor, path18);
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
    function callVisitor(key, node, visitor, path18) {
      if (typeof visitor === "function")
        return visitor(key, node, path18);
      if (identity.isMap(node))
        return visitor.Map?.(key, node, path18);
      if (identity.isSeq(node))
        return visitor.Seq?.(key, node, path18);
      if (identity.isPair(node))
        return visitor.Pair?.(key, node, path18);
      if (identity.isScalar(node))
        return visitor.Scalar?.(key, node, path18);
      if (identity.isAlias(node))
        return visitor.Alias?.(key, node, path18);
      return void 0;
    }
    function replaceNode(key, path18, node) {
      const parent = path18[path18.length - 1];
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
    function collectionFromPath(schema, path18, value) {
      let v = value;
      for (let i = path18.length - 1; i >= 0; --i) {
        const k = path18[i];
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
    var isEmptyPath = (path18) => path18 == null || typeof path18 === "object" && !!path18[Symbol.iterator]().next().done;
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
      addIn(path18, value) {
        if (isEmptyPath(path18))
          this.add(value);
        else {
          const [key, ...rest] = path18;
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
      deleteIn(path18) {
        const [key, ...rest] = path18;
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
      getIn(path18, keepScalar) {
        const [key, ...rest] = path18;
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
      hasIn(path18) {
        const [key, ...rest] = path18;
        if (rest.length === 0)
          return this.has(key);
        const node = this.get(key, true);
        return identity.isCollection(node) ? node.hasIn(rest) : false;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path18, value) {
        const [key, ...rest] = path18;
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
    function stringify(item, ctx, onComment, onChompKeep) {
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
    exports.stringify = stringify;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyPair.js
var require_stringifyPair = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyPair.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var stringify = require_stringify();
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
      let str = stringify.stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
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
      const valueStr = stringify.stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
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
    var stringify = require_stringify();
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
        const strCtx = stringify.createStringifyContext(ctx.doc, {});
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
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyCollection(collection, ctx, options) {
      const flow = ctx.inFlow ?? collection.flow;
      const stringify2 = flow ? stringifyFlowCollection : stringifyBlockCollection;
      return stringify2(collection, ctx, options);
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
        let str2 = stringify.stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
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
        let str = stringify.stringify(item, itemCtx, () => comment = null);
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
    var stringify = require_stringify();
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
      const ctx = stringify.createStringifyContext(doc, options);
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
        let body = stringify.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
        if (contentComment)
          body += stringifyComment.lineComment(body, "", commentString(contentComment));
        if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") {
          lines[lines.length - 1] = `--- ${body}`;
        } else
          lines.push(body);
      } else {
        lines.push(stringify.stringify(doc.contents, ctx));
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
      addIn(path18, value) {
        if (assertCollection(this.contents))
          this.contents.addIn(path18, value);
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
      deleteIn(path18) {
        if (Collection.isEmptyPath(path18)) {
          if (this.contents == null)
            return false;
          this.contents = null;
          return true;
        }
        return assertCollection(this.contents) ? this.contents.deleteIn(path18) : false;
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
      getIn(path18, keepScalar) {
        if (Collection.isEmptyPath(path18))
          return !keepScalar && identity.isScalar(this.contents) ? this.contents.value : this.contents;
        return identity.isCollection(this.contents) ? this.contents.getIn(path18, keepScalar) : void 0;
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
      hasIn(path18) {
        if (Collection.isEmptyPath(path18))
          return this.contents !== void 0;
        return identity.isCollection(this.contents) ? this.contents.hasIn(path18) : false;
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
      setIn(path18, value) {
        if (Collection.isEmptyPath(path18)) {
          this.contents = value;
        } else if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, Array.from(path18), value);
        } else if (assertCollection(this.contents)) {
          this.contents.setIn(path18, value);
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
    var stringify = (cst) => "type" in cst ? stringifyToken(cst) : stringifyItem(cst);
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
    exports.stringify = stringify;
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
    visit.itemAtPath = (cst, path18) => {
      let item = cst;
      for (const [field2, index] of path18) {
        const tok = item?.[field2];
        if (tok && "items" in tok) {
          item = tok.items[index];
        } else
          return void 0;
      }
      return item;
    };
    visit.parentCollection = (cst, path18) => {
      const parent = visit.itemAtPath(cst, path18.slice(0, -1));
      const field2 = path18[path18.length - 1][0];
      const coll = parent?.[field2];
      if (coll && "items" in coll)
        return coll;
      throw new Error("Parent collection not found");
    };
    function _visit(path18, item, visitor) {
      let ctrl = visitor(item, path18);
      if (typeof ctrl === "symbol")
        return ctrl;
      for (const field2 of ["key", "value"]) {
        const token = item[field2];
        if (token && "items" in token) {
          for (let i = 0; i < token.items.length; ++i) {
            const ci = _visit(Object.freeze(path18.concat([[field2, i]])), token.items[i], visitor);
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
            ctrl = ctrl(item, path18);
        }
      }
      return typeof ctrl === "function" ? ctrl(item, path18) : ctrl;
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
              const fs17 = this.flowScalar(this.type);
              if (atNextItem || it.value) {
                map.items.push({ start, key: fs17, sep: [] });
                this.onKeyLine = true;
              } else if (it.sep) {
                this.stack.push(fs17);
              } else {
                Object.assign(it, { key: fs17, sep: [] });
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
              const fs17 = this.flowScalar(this.type);
              if (!it || it.value)
                fc.items.push({ start: [], key: fs17, sep: [] });
              else if (it.sep)
                this.stack.push(fs17);
              else
                Object.assign(it, { key: fs17, sep: [] });
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
    function parseDocument6(source, options = {}) {
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
      const doc = parseDocument6(src, options);
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
    function stringify(value, replacer, options) {
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
    exports.parseDocument = parseDocument6;
    exports.stringify = stringify;
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
import { randomUUID } from "crypto";
import { promises as fs3 } from "fs";
import path3 from "path";
function requiredString(doc, key) {
  const value = doc[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid Run state: ${key} must be a non-empty string`);
  }
  return value;
}
function requiredRunReference(doc, key) {
  const value = requiredString(doc, key);
  if (path3.isAbsolute(value) || /^(?:[A-Za-z]:|[\\/]|~)/u.test(value) || value.split(/[\\/]/u).includes("..")) {
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
async function readRunState(changeDir) {
  const file = path3.join(changeDir, RUN_STATE_FILE);
  let raw;
  try {
    raw = await fs3.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const json = JSON.parse(raw);
  return runStateFromJson(json);
}
async function writeRunState(changeDir, state) {
  await fs3.mkdir(path3.join(changeDir, ".comet"), { recursive: true });
  const file = path3.join(changeDir, RUN_STATE_FILE);
  const temporary = path3.join(changeDir, ".comet", `run-state.${randomUUID()}.tmp`);
  await fs3.writeFile(temporary, JSON.stringify(runStateToJson(state), null, 2), "utf8");
  await fs3.rename(temporary, file);
}
async function removeRunState(changeDir) {
  await fs3.rm(path3.join(changeDir, RUN_STATE_FILE), { force: true });
}
var field, RUN_STATE_FILE;
var init_state = __esm({
  "domains/engine/state.ts"() {
    "use strict";
    field = (doc, key) => {
      const value = doc[key];
      return value === null || value === void 0 ? null : String(value);
    };
    RUN_STATE_FILE = ".comet/run-state.json";
  }
});

// domains/comet-classic/classic-cli.ts
import { pathToFileURL } from "url";

// domains/comet-classic/classic-archive.ts
import { createHash as createHash3 } from "crypto";
import { spawnSync } from "child_process";
import { promises as fs11 } from "fs";
import path12 from "path";

// domains/comet-classic/classic-paths.ts
import { promises as fs } from "fs";
import path from "path";
async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
function filesystemPath(relativePath2) {
  return path.resolve(...relativePath2.split("/"));
}
function openSpecChangeNameError(name) {
  if (!name) return "Change name cannot be empty";
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(name)) {
    return `Invalid change name: '${name}'
Valid format: lowercase kebab-case (a-z, 0-9, single hyphens)`;
  }
  if (name.includes("..")) return "Change name cannot contain '..' (path traversal not allowed)";
  return null;
}
async function resolveClassicChangeDirectory(name) {
  const active = `openspec/changes/${name}`;
  if (await exists(filesystemPath(active))) {
    return { label: active, directory: filesystemPath(active) };
  }
  const archiveRoot = "openspec/changes/archive";
  const exactArchive = `${archiveRoot}/${name}`;
  if (await exists(filesystemPath(exactArchive))) {
    return { label: exactArchive, directory: filesystemPath(exactArchive) };
  }
  if (await exists(filesystemPath(archiveRoot))) {
    const matches = [];
    for (const entry2 of await fs.readdir(filesystemPath(archiveRoot), { withFileTypes: true })) {
      if (!entry2.isDirectory() || !entry2.name.endsWith(`-${name}`)) continue;
      const candidate = `${archiveRoot}/${entry2.name}`;
      if (await exists(path.join(filesystemPath(candidate), ".comet.yaml"))) {
        matches.push(candidate);
      }
    }
    const latest = matches.sort((left, right) => right.localeCompare(left))[0];
    if (latest) return { label: latest, directory: filesystemPath(latest) };
  }
  return { label: active, directory: filesystemPath(active) };
}

// domains/comet-classic/classic-runtime-run.ts
import { promises as fs9 } from "fs";
import path10 from "path";
import { fileURLToPath } from "url";

// domains/comet-classic/classic-evidence.ts
import { promises as fs2 } from "fs";
import path2 from "path";
async function fileExists(file) {
  try {
    return (await fs2.stat(file)).isFile();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
function projectRootFor(changeDir) {
  let cursor = path2.resolve(changeDir);
  while (path2.dirname(cursor) !== cursor) {
    if (path2.basename(cursor) === "openspec") return path2.dirname(cursor);
    cursor = path2.dirname(cursor);
  }
  throw new Error(`Classic change is not inside an openspec directory: ${changeDir}`);
}
function relativeSource(projectRoot, file) {
  return path2.relative(projectRoot, file).split(path2.sep).join("/");
}
async function linkedFileEvidence(projectRoot, code, relativePath2) {
  if (!relativePath2) return { code, satisfied: false };
  const file = path2.resolve(projectRoot, relativePath2);
  return {
    code,
    satisfied: await fileExists(file),
    source: relativeSource(projectRoot, file)
  };
}
async function directFileEvidence(projectRoot, code, file) {
  return {
    code,
    satisfied: await fileExists(file),
    source: relativeSource(projectRoot, file)
  };
}
async function deltaSpecEvidence(projectRoot, changeDir) {
  const specsDir = path2.join(changeDir, "specs");
  let entries;
  try {
    entries = await fs2.readdir(specsDir);
  } catch (error) {
    if (error.code === "ENOENT") {
      return { code: "openspec.delta-spec", satisfied: false };
    }
    throw error;
  }
  const candidates = entries.map((entry2) => path2.join(specsDir, entry2, "spec.md"));
  const existing = (await Promise.all(candidates.map(async (file) => await fileExists(file) ? file : null))).filter((file) => file !== null);
  return {
    code: "openspec.delta-spec",
    satisfied: existing.length > 0,
    source: existing[0] ? relativeSource(projectRoot, existing[0]) : void 0,
    detail: `${existing.length} delta spec${existing.length === 1 ? "" : "s"}`
  };
}
async function taskEvidence(projectRoot, tasksFile) {
  let source;
  try {
    source = await fs2.readFile(tasksFile, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return { code: "build.tasks-complete", satisfied: false };
    }
    throw error;
  }
  const tasks = [...source.matchAll(/^\s*[-*]\s+\[([ xX])\]\s+/gmu)];
  const complete = tasks.filter((match) => match[1].toLowerCase() === "x").length;
  return {
    code: "build.tasks-complete",
    satisfied: tasks.length > 0 && complete === tasks.length,
    source: relativeSource(projectRoot, tasksFile),
    detail: `${complete} of ${tasks.length} tasks complete`
  };
}
function evidenceSatisfied(evidence, code) {
  return evidence.some((item) => item.code === code && item.satisfied);
}
async function collectClassicEvidence(changeDir, projection) {
  const projectRoot = projectRootFor(changeDir);
  const classic = projection.classic;
  const proposal = path2.join(changeDir, "proposal.md");
  const design = path2.join(changeDir, "design.md");
  const tasks = path2.join(changeDir, "tasks.md");
  const checkpoint = projection.run ? path2.resolve(changeDir, projection.run.checkpointRef) : path2.join(changeDir, ".comet", "checkpoint.json");
  const evidence = await Promise.all([
    directFileEvidence(projectRoot, "openspec.proposal", proposal),
    directFileEvidence(projectRoot, "openspec.design", design),
    directFileEvidence(projectRoot, "openspec.tasks", tasks),
    deltaSpecEvidence(projectRoot, changeDir),
    linkedFileEvidence(projectRoot, "design.document", classic?.designDoc ?? null),
    linkedFileEvidence(projectRoot, "build.plan", classic?.plan ?? null),
    taskEvidence(projectRoot, tasks),
    linkedFileEvidence(projectRoot, "verification.report", classic?.verificationReport ?? null),
    linkedFileEvidence(projectRoot, "design.handoff", classic?.handoffContext ?? null),
    directFileEvidence(projectRoot, "run.checkpoint", checkpoint)
  ]);
  const handoff = evidence.find((item) => item.code === "design.handoff");
  if (handoff && !classic?.handoffHash) {
    handoff.satisfied = false;
    handoff.detail = "handoff hash is missing";
  }
  return evidence;
}

// domains/comet-classic/classic-migrate.ts
import { createHash as createHash2, randomUUID as randomUUID5 } from "crypto";
import { promises as fs8 } from "fs";
import path9 from "path";

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
    classic.buildMode === "direct" && classic.tddMode === "direct" && classic.isolation === "branch" && classic.verifyMode === "light"
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
function resolveArchive(profile, classic, evidence) {
  if (classic.verifyResult !== "pass") {
    throw new Error("archive requires verify_result=pass");
  }
  return evidenceSatisfied(evidence, "archive.confirmed") ? `${profile}.archive.execute` : `${profile}.archive.confirm`;
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
      return resolveArchive(profile, classic, evidence);
  }
}

// domains/comet-classic/classic-store.ts
var import_yaml = __toESM(require_dist(), 1);
import { randomUUID as randomUUID2 } from "crypto";
import { promises as fs4 } from "fs";
import path4 from "path";

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
var ISOLATIONS = ["branch", "worktree"];
var VERIFY_MODES = ["light", "full"];
var VERIFY_RESULTS = ["pending", "pass", "fail"];
var BRANCH_STATUSES = ["pending", "handled"];
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
  "verify_mode",
  "auto_transition",
  "base_ref",
  "design_doc",
  "plan",
  "verify_result",
  "verification_report",
  "branch_status",
  "created_at",
  "verified_at",
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
function relativePath(doc, key) {
  const value = nullableString(doc, key);
  if (value === null) return null;
  if (/^(?:[A-Za-z]:|[\\/]|~)/u.test(value) || value.split(/[\\/]/u).includes("..")) {
    throw new Error(`Invalid Classic state: ${key} must be a relative repository path`);
  }
  return value;
}
function sha256(doc, key) {
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
    verifyMode: enumValue(doc, "verify_mode", VERIFY_MODES),
    autoTransition: booleanValue(doc, "auto_transition"),
    baseRef: nullableString(doc, "base_ref"),
    designDoc: relativePath(doc, "design_doc"),
    plan: relativePath(doc, "plan"),
    verifyResult: enumValue(doc, "verify_result", VERIFY_RESULTS, false),
    verificationReport: relativePath(doc, "verification_report"),
    branchStatus: enumValue(doc, "branch_status", BRANCH_STATUSES),
    createdAt: nullableString(doc, "created_at"),
    verifiedAt: nullableString(doc, "verified_at"),
    archived: booleanValue(doc, "archived", false),
    directOverride: booleanValue(doc, "direct_override"),
    handoffContext: relativePath(doc, "handoff_context"),
    handoffHash: sha256(doc, "handoff_hash"),
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
    verify_mode: state.verifyMode,
    auto_transition: state.autoTransition,
    base_ref: state.baseRef,
    design_doc: state.designDoc,
    plan: state.plan,
    verify_result: state.verifyResult,
    verification_report: state.verificationReport,
    branch_status: state.branchStatus,
    created_at: state.createdAt,
    verified_at: state.verifiedAt,
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
    source = await fs4.readFile(file, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return new import_yaml.Document({});
  }
  const document = (0, import_yaml.parseDocument)(source);
  if (document.errors.length > 0) {
    throw new Error(`Invalid Classic state document: ${document.errors[0].message}`);
  }
  documentRecord(document);
  return document;
}
async function readClassicState(changeDir) {
  const file = path4.join(changeDir, ".comet.yaml");
  const document = await readDocument(file);
  let doc = documentRecord(document);
  let migrated = stripLegacyCommandFields(document);
  if (migrated) doc = documentRecord(document);
  let run = await readRunState(changeDir);
  if (!run && doc.run_id && doc.skill) {
    const { runStateFromDocument: runStateFromDocument2 } = await Promise.resolve().then(() => (init_state(), state_exports));
    run = runStateFromDocument2(doc);
    if (run) {
      await writeRunState(changeDir, run);
      stripLegacyRunFields(document);
      migrated = true;
    }
  }
  if (migrated) {
    const temporary = path4.join(changeDir, `.comet.yaml.${randomUUID2()}.tmp`);
    await fs4.writeFile(temporary, document.toString(), "utf8");
    await fs4.rename(temporary, file);
  }
  return parseClassicStateDocument(documentRecord(document), run);
}
async function readLegacyState(changeDir) {
  const document = await readDocument(path4.join(changeDir, ".comet.yaml"));
  return readLegacyStateSummary(documentRecord(document));
}
async function writeClassicState(changeDir, projection) {
  const file = path4.join(changeDir, ".comet.yaml");
  const document = await readDocument(file);
  applyProjection(document, {
    ...projection,
    unknownKeys: projection.unknownKeys ?? []
  });
  parseClassicStateDocument(documentRecord(document), projection.run ?? null);
  await fs4.mkdir(changeDir, { recursive: true });
  const temporary = path4.join(changeDir, `.comet.yaml.${randomUUID2()}.tmp`);
  try {
    await fs4.writeFile(temporary, document.toString(), "utf8");
    await fs4.rename(temporary, file);
  } catch (error) {
    await fs4.rm(temporary, { force: true });
    throw error;
  }
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
import { randomUUID as randomUUID3 } from "crypto";
import { promises as fs5 } from "fs";
import path5 from "path";
function resolveRunPath(changeDir, relativePath2) {
  if (path5.isAbsolute(relativePath2))
    throw new Error("Run path must stay inside the change directory");
  const root = path5.resolve(changeDir);
  const target = path5.resolve(root, relativePath2);
  if (target !== root && !target.startsWith(root + path5.sep)) {
    throw new Error("Run path must stay inside the change directory");
  }
  return target;
}
async function atomicWrite(file, content) {
  await fs5.mkdir(path5.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID3()}.tmp`;
  await fs5.writeFile(temporary, content, "utf8");
  await fs5.rename(temporary, file);
}
async function readOptionalText(file) {
  try {
    return await fs5.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function appendTrajectory(changeDir, relativePath2, event) {
  const file = resolveRunPath(changeDir, relativePath2);
  await fs5.mkdir(path5.dirname(file), { recursive: true });
  await fs5.appendFile(file, JSON.stringify(event) + "\n", "utf8");
}
async function readTrajectory(changeDir, relativePath2) {
  const raw = await readOptionalText(resolveRunPath(changeDir, relativePath2));
  if (raw === null) return [];
  return raw.split(/\r?\n/).map((line, index) => ({ line, number: index + 1 })).filter(({ line }) => line.length > 0).map(({ line, number }) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid Trajectory event at line ${number}`, { cause: error });
    }
  });
}
async function readArtifacts(changeDir, relativePath2) {
  try {
    return JSON.parse(await fs5.readFile(resolveRunPath(changeDir, relativePath2), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}
async function writeArtifacts(changeDir, relativePath2, artifacts) {
  await atomicWrite(
    resolveRunPath(changeDir, relativePath2),
    JSON.stringify(artifacts, null, 2) + "\n"
  );
}
async function writeContext(changeDir, relativePath2, context) {
  await atomicWrite(resolveRunPath(changeDir, relativePath2), context);
}
async function readContext(changeDir, relativePath2) {
  return readOptionalText(resolveRunPath(changeDir, relativePath2));
}
async function writePendingAction(changeDir, relativePath2, action) {
  await atomicWrite(
    resolveRunPath(changeDir, relativePath2),
    JSON.stringify(action, null, 2) + "\n"
  );
}
async function readPendingAction(changeDir, relativePath2) {
  try {
    return JSON.parse(await fs5.readFile(resolveRunPath(changeDir, relativePath2), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function clearPendingAction(changeDir, relativePath2) {
  try {
    await fs5.unlink(resolveRunPath(changeDir, relativePath2));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
async function writeCheckpoint(changeDir, relativePath2, checkpoint) {
  await atomicWrite(
    resolveRunPath(changeDir, relativePath2),
    JSON.stringify(checkpoint, null, 2) + "\n"
  );
}
async function readCheckpoint(changeDir, relativePath2) {
  const raw = await readOptionalText(resolveRunPath(changeDir, relativePath2));
  return raw === null ? null : JSON.parse(raw);
}

// domains/skill/snapshot.ts
import { createHash, randomUUID as randomUUID4 } from "crypto";
import { promises as fs7 } from "fs";
import path8 from "path";

// domains/skill/load.ts
var import_yaml2 = __toESM(require_dist(), 1);
import { promises as fs6 } from "fs";
import path6 from "path";
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
  const source = await fs6.readFile(filePath, "utf8");
  try {
    return (0, import_yaml2.parse)(source);
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
    await fs6.access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
async function readRuntimeChecks(cometRoot) {
  const checksPath = path6.join(cometRoot, "checks.yaml");
  const evalsPath = path6.join(cometRoot, "evals.yaml");
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
  const packageRoot = path6.resolve(options.root);
  const controlRoot = path6.resolve(options.controlRoot);
  if (options.requireSkillMarkdown) {
    await fs6.access(path6.join(packageRoot, "SKILL.md"));
  }
  const skillPath = path6.join(controlRoot, "skill.yaml");
  const guardrailsPath = path6.join(controlRoot, "guardrails.yaml");
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
  const packageRoot = path6.resolve(root);
  return loadPackageFromLayout({
    root: packageRoot,
    controlRoot: path6.join(packageRoot, "comet"),
    packageKind: "skill",
    requireSkillMarkdown: true
  });
}
async function loadRuntimePackage(root) {
  const packageRoot = path6.resolve(root);
  return loadPackageFromLayout({
    root: packageRoot,
    controlRoot: packageRoot,
    packageKind: "runtime",
    requireSkillMarkdown: false
  });
}
function loadSkillPackageDocument(document, root, filePath = path6.join(root, "package.json")) {
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
    root: path6.resolve(root),
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
import path7 from "path";
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
    const normalized2 = path7.posix.normalize(tool.source.replaceAll("\\", "/"));
    if (path7.isAbsolute(tool.source) || normalized2 === ".." || normalized2.startsWith("../")) {
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
  return path8.posix.normalize(source.replaceAll("\\", "/"));
}
function assertInside(parent, target, label) {
  const relative = path8.relative(parent, target);
  if (relative === "" || !path8.isAbsolute(relative) && !relative.startsWith(`..${path8.sep}`)) {
    return;
  }
  throw new Error(`${label} resolves outside the Skill package`);
}
async function readPackageFile(root, relativePath2, label) {
  const normalized2 = normalizedRelativePath(relativePath2);
  if (path8.posix.isAbsolute(normalized2) || normalized2 === ".." || normalized2.startsWith("../")) {
    throw new Error(`${label} resolves outside the Skill package`);
  }
  const target = path8.resolve(root, ...normalized2.split("/"));
  assertInside(root, target, label);
  let realTarget;
  try {
    realTarget = await fs7.realpath(target);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`${label} does not exist: ${relativePath2}`, { cause: error });
    }
    throw error;
  }
  assertInside(root, realTarget, label);
  if (!(await fs7.stat(realTarget)).isFile()) {
    throw new Error(`${label} is not a file: ${relativePath2}`);
  }
  return { path: normalized2, content: await fs7.readFile(realTarget) };
}
async function snapshotFiles(pkg) {
  const root = await fs7.realpath(pkg.root);
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
    sha256: createHash("sha256").update(file.content).digest("hex")
  }));
  return createHash("sha256").update(JSON.stringify(stable({ package: document, files: fileDigests }))).digest("hex");
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
    await fs7.access(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function verifyPublishedSnapshot(snapshotDir, material) {
  try {
    const storedHash = (await fs7.readFile(path8.join(snapshotDir, "sha256"), "utf8")).trim();
    if (storedHash !== material.hash) throw new Error("hash mismatch");
    const storedPackage = await fs7.readFile(path8.join(snapshotDir, "package.json"), "utf8");
    if (storedPackage !== packageJson(material.document)) throw new Error("package mismatch");
    for (const file of material.files) {
      const stored = await fs7.readFile(path8.join(snapshotDir, ...file.path.split("/")));
      if (!stored.equals(file.content)) throw new Error(`file mismatch: ${file.path}`);
    }
  } catch (error) {
    throw new Error(`Existing Skill snapshot is invalid: ${material.hash}`, { cause: error });
  }
}
async function createSkillSnapshot(pkg, changeDir) {
  const material = await snapshotMaterial(pkg);
  const snapshotsRoot = path8.resolve(changeDir, ".comet", "skill-snapshots");
  const snapshotDir = path8.join(snapshotsRoot, material.hash);
  await fs7.mkdir(snapshotsRoot, { recursive: true });
  if (await pathExists(snapshotDir)) {
    await verifyPublishedSnapshot(snapshotDir, material);
    return { hash: material.hash, snapshotDir };
  }
  const temporaryDir = path8.join(snapshotsRoot, `.tmp-${randomUUID4()}`);
  assertInside(snapshotsRoot, temporaryDir, "Temporary snapshot");
  assertInside(snapshotsRoot, snapshotDir, "Published snapshot");
  try {
    await fs7.mkdir(temporaryDir);
    for (const file of material.files) {
      const destination = path8.join(temporaryDir, ...file.path.split("/"));
      assertInside(temporaryDir, destination, `Snapshot file ${file.path}`);
      await fs7.mkdir(path8.dirname(destination), { recursive: true });
      await fs7.writeFile(destination, file.content);
    }
    await fs7.writeFile(path8.join(temporaryDir, "package.json"), packageJson(material.document));
    await fs7.writeFile(path8.join(temporaryDir, "sha256"), material.hash + "\n");
    await fs7.rename(temporaryDir, snapshotDir);
  } catch (error) {
    if (await pathExists(snapshotDir)) {
      try {
        await verifyPublishedSnapshot(snapshotDir, material);
      } finally {
        await fs7.rm(temporaryDir, { recursive: true, force: true });
      }
      return { hash: material.hash, snapshotDir };
    }
    await fs7.rm(temporaryDir, { recursive: true, force: true });
    throw error;
  }
  return { hash: material.hash, snapshotDir };
}
async function readSkillSnapshot(changeDir, hash) {
  if (!/^[a-f0-9]{64}$/u.test(hash)) {
    throw new Error(`Invalid Skill snapshot hash: ${hash}`);
  }
  const snapshotsRoot = path8.resolve(changeDir, ".comet", "skill-snapshots");
  const snapshotDir = path8.join(snapshotsRoot, hash);
  assertInside(snapshotsRoot, snapshotDir, "Skill snapshot");
  try {
    const storedHash = (await fs7.readFile(path8.join(snapshotDir, "sha256"), "utf8")).trim();
    if (storedHash !== hash) {
      throw new Error(`stored hash is ${storedHash || "(empty)"}`);
    }
    const packagePath = path8.join(snapshotDir, "package.json");
    const document = JSON.parse(await fs7.readFile(packagePath, "utf8"));
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
    await fs8.access(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
function projectRootFor2(changeDir) {
  let cursor = path9.resolve(changeDir);
  while (path9.dirname(cursor) !== cursor) {
    if (path9.basename(cursor) === "openspec") return path9.dirname(cursor);
    cursor = path9.dirname(cursor);
  }
  throw new Error(`Classic change is not inside an openspec directory: ${changeDir}`);
}
function sha2562(content) {
  return createHash2("sha256").update(content).digest("hex");
}
function artifactHash(artifacts) {
  return sha2562(
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
  const projectRoot = projectRootFor2(changeDir);
  const artifacts = Object.fromEntries(
    evidence.filter((item) => item.satisfied && item.source).map((item) => [artifactKey(item.code), item.source])
  );
  const progress = path9.join(changeDir, "subagent-progress.md");
  if (await pathExists2(progress)) {
    artifacts.subagent_progress = path9.relative(projectRoot, progress).split(path9.sep).join("/");
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
  await Promise.all(files.map((file) => fs8.rm(file, { recursive: true, force: true })));
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
        snapshotDir: path9.join(changeDir, ".comet", "skill-snapshots", projection.run.skillHash)
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
  const expectedSnapshotDir = path9.join(changeDir, ".comet", "skill-snapshots", expectedHash);
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
    const projectRoot = projectRootFor2(changeDir);
    const handoff = evidence.find((item) => item.code === "design.handoff" && item.satisfied);
    let context = null;
    if (handoff?.source) {
      context = await fs8.readFile(path9.resolve(projectRoot, handoff.source), "utf8");
      await writeContext(changeDir, run.contextRef, context);
      createdFiles.push(path9.resolve(changeDir, run.contextRef));
    }
    await writeArtifacts(changeDir, run.artifactsRef, artifacts);
    createdFiles.push(path9.resolve(changeDir, run.artifactsRef));
    const timestamp = (options.now?.() ?? /* @__PURE__ */ new Date()).toISOString();
    const checkpoint = {
      runId: run.runId,
      stateVersion: 1,
      trajectoryOffset: 2,
      contextHash: context === null ? null : sha2562(context),
      artifactsHash: artifactHash(artifacts),
      createdAt: timestamp
    };
    await writeCheckpoint(changeDir, run.checkpointRef, checkpoint);
    createdFiles.push(path9.resolve(changeDir, run.checkpointRef));
    createdFiles.push(path9.resolve(changeDir, run.trajectoryRef));
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
    if (!snapshotExisted) await fs8.rm(expectedSnapshotDir, { recursive: true, force: true });
    throw error;
  }
}

// domains/comet-classic/classic-runtime-run.ts
async function directoryExists(directory) {
  try {
    return (await fs9.stat(directory)).isDirectory();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function fileExists2(file) {
  try {
    return (await fs9.stat(file)).isFile();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
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
  const runtimeDirectory = path10.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.COMET_RUNTIME_CLASSIC_ROOT,
    path10.resolve(runtimeDirectory, "..", "runtime", "classic"),
    path10.resolve(runtimeDirectory, "..", "..", "comet", "runtime", "classic"),
    path10.resolve(runtimeDirectory, "..", "..", "assets", "skills", "comet", "runtime", "classic"),
    path10.resolve("assets", "skills", "comet", "runtime", "classic"),
    process.env.COMET_CLASSIC_SKILL_ROOT,
    path10.resolve(runtimeDirectory, "..", "..", "comet-classic"),
    path10.resolve(runtimeDirectory, "..", "..", "assets", "skills", "comet-classic"),
    path10.resolve("assets", "skills", "comet-classic")
  ].filter((candidate) => Boolean(candidate));
  for (const candidate of candidates) {
    if (await directoryExists(candidate)) return candidate;
  }
  return null;
}
async function loadClassicRuntimePackage(root) {
  if (await fileExists2(path10.join(root, "skill.yaml"))) {
    return loadRuntimePackage(root);
  }
  return loadSkillPackage(root);
}
async function ensureClassicRuntimeRun(changeDir) {
  const root = await classicRuntimeRoot();
  return ensureClassicRun(changeDir, {
    skillPackage: root ? await loadClassicRuntimePackage(root) : embeddedClassicRuntimePackage(path10.dirname(fileURLToPath(import.meta.url)))
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
import { promises as fs10 } from "fs";
import path11 from "path";
var CLASSIC_STATE_EVENT_LOG = path11.join(".comet", "state-events.jsonl");
async function appendClassicStateEvent(changeDir, input) {
  const record = {
    schemaVersion: 1,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    ...input
  };
  const file = path11.join(changeDir, CLASSIC_STATE_EVENT_LOG);
  await fs10.mkdir(path11.dirname(file), { recursive: true });
  await fs10.appendFile(file, `${JSON.stringify(record)}
`, "utf8");
  return record;
}

// domains/comet-classic/classic-transitions.ts
var CLASSIC_TRANSITION_EVENTS = [
  "open-complete",
  "design-complete",
  "build-complete",
  "verify-pass",
  "verify-fail",
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
    guardRefs: ["verification-report-present", "branch-status-handled"]
  },
  "verify-fail": {
    event: "verify-fail",
    from: "verify",
    guardRefs: ["verification-failed"]
  },
  "archive-reopen": {
    event: "archive-reopen",
    from: "archive",
    guardRefs: ["archive-not-finalized"]
  },
  archived: {
    event: "archived",
    from: "archive",
    guardRefs: ["verify-result-pass"]
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
    if (!preserveEvidence) {
      setField(classic, effects, "verificationReport", null);
      setField(classic, effects, "branchStatus", "pending");
    }
  } else if (event === "verify-pass") {
    setField(classic, effects, "verifyResult", "pass");
    setField(classic, effects, "phase", "archive");
    setField(classic, effects, "verifiedAt", dateOnly(now));
  } else if (event === "verify-fail") {
    setField(classic, effects, "verifyResult", "fail");
    setField(classic, effects, "phase", "build");
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
  } else if (event === "archive-reopen") {
    if (classic.archived) throw new Error(`Cannot apply ${event}: already archived`);
    setField(classic, effects, "verifyResult", "pending");
    setField(classic, effects, "phase", "verify");
    setField(classic, effects, "verifiedAt", null);
  } else {
    if (classic.verifyResult !== "pass") {
      throw new Error(`Cannot apply ${event}: verifyResult must be pass`);
    }
    setField(classic, effects, "archived", true);
  }
  return { classic, effects, definition };
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
  stepsOk = 0;
  stepsTotal = 0;
  toResult(exitCode = 0) {
    return {
      exitCode,
      ...this.stderr.length > 0 ? { stderr: this.stderr.join("\n") + "\n" } : {}
    };
  }
};
async function exists2(file) {
  try {
    await fs11.access(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
function validateChangeName(name) {
  const error = openSpecChangeNameError(name);
  if (error) throw new ArchiveFailure(red(`FATAL: ${error}`));
}
function hashText(content) {
  return createHash3("sha256").update(content).digest("hex");
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
async function findArchiveDir(change, preferred) {
  if (await exists2(preferred)) return preferred;
  const archiveRoot = "openspec/changes/archive";
  if (!await exists2(archiveRoot)) return null;
  for (const entry2 of (await fs11.readdir(archiveRoot)).sort()) {
    if (!entry2.endsWith(`-${change}`)) continue;
    const candidate = `${archiveRoot}/${entry2}`;
    if ((await fs11.stat(candidate)).isDirectory()) return candidate;
  }
  return null;
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
async function annotateFrontmatter(output, file, archiveName, extraFields, dryRun) {
  if (!await exists2(file)) return;
  if (dryRun) {
    output.stderr.push(yellow(`  [DRY-RUN] Would annotate: ${file}`));
    output.stepsOk += 1;
    output.stepsTotal += 1;
    return;
  }
  const original = await fs11.readFile(file, "utf8");
  const firstLine = original.split(/\r?\n/u)[0] ?? "";
  let updated;
  if (firstLine === "---") {
    const lines = original.split(/\r?\n/u);
    const out = [];
    let sawFirst = false;
    for (const line of lines) {
      if (/^archived-with:/u.test(line)) continue;
      if (line === "---") {
        if (!sawFirst) {
          out.push(line);
          sawFirst = true;
          continue;
        }
        out.push(`archived-with: ${archiveName}`);
        if (extraFields) out.push(extraFields);
        out.push(line);
      } else {
        out.push(line);
      }
    }
    updated = `${out.join("\n")}
`;
  } else {
    const header = ["---", `archived-with: ${archiveName}`];
    if (extraFields) header.push(extraFields);
    header.push("status: final", "---");
    updated = `${header.join("\n")}
${original}`;
    if (!updated.endsWith("\n")) updated += "\n";
  }
  await fs11.writeFile(file, updated);
  output.stderr.push(green(`  [OK] Annotated: ${file}`));
  output.stepsOk += 1;
  output.stepsTotal += 1;
}
async function verifyMainSpecsClean() {
  const specsRoot = "openspec/specs";
  if (!await exists2(specsRoot)) return;
  let found = false;
  for (const entry2 of await fs11.readdir(specsRoot)) {
    const specFile = `${specsRoot}/${entry2}/spec.md`;
    if (!await exists2(specFile)) continue;
    const matches = (await fs11.readFile(specFile, "utf8")).split(/\r?\n/u).map((line, index) => ({ line, number: index + 1 })).filter((item) => /^## (ADDED|MODIFIED|REMOVED|RENAMED) Requirements$/u.test(item.line));
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
    const activeDir = `openspec/changes/${change}`;
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    let archiveName = `${today}-${change}`;
    let archiveDir = `openspec/changes/archive/${archiveName}`;
    const openspec = process.env.COMET_OPENSPEC || "openspec";
    output.stderr.push(`=== Comet Archive: ${change} ===`);
    const activeExists = await exists2(`${activeDir}/.comet.yaml`);
    const recoveredArchive = activeExists ? null : await findArchiveDir(change, archiveDir);
    const changeDir = activeExists ? activeDir : recoveredArchive;
    if (!changeDir || !await exists2(`${changeDir}/.comet.yaml`)) {
      throw new ArchiveFailure(red(`FATAL: .comet.yaml not found in ${activeDir}/`));
    }
    if (recoveredArchive) {
      archiveDir = recoveredArchive;
      archiveName = path12.basename(recoveredArchive);
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
    if (activeExists && await exists2(archiveDir)) {
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
      const runtime = await ensureClassicRuntimeRun(changeDir);
      const actionId = `classic-archive:${change}`;
      const pendingAction = await readPendingAction(changeDir, runtime.run.pendingRef);
      const recovering = Boolean(recoveredArchive) || pendingAction?.id === actionId && pendingAction.type === "checkpoint" && pendingAction.ref === change;
      if (runtime.run.pending && runtime.run.pending !== actionId) {
        throw new ArchiveFailure(red(`FATAL: another action is pending: ${runtime.run.pending}`));
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
        const archiveRun = spawnSync(openspec, ["archive", change, "--yes"], {
          encoding: "utf8",
          shell: process.platform === "win32"
        });
        if (archiveRun.stdout) process.stderr.write(archiveRun.stdout);
        if (archiveRun.stderr) process.stderr.write(archiveRun.stderr);
        if (archiveRun.error && archiveRun.error.code === "ENOENT") {
          throw new ArchiveFailure(
            [
              red(`FATAL: OpenSpec CLI not found: ${openspec}`),
              red("Install OpenSpec or set COMET_OPENSPEC to the openspec executable.")
            ].join("\n")
          );
        }
        if (archiveRun.status !== 0) {
          throw new ArchiveFailure("", archiveRun.status ?? 1);
        }
      }
      const resolvedArchive = await findArchiveDir(change, archiveDir);
      if (!resolvedArchive) {
        output.stderr.push(red("  [FAIL] OpenSpec archive output not found"));
        output.stepsTotal += 1;
        output.stderr.push("");
        output.stderr.push(
          green(`Archive complete. ${output.stepsOk}/${output.stepsTotal} steps succeeded.`)
        );
        return output.toResult(1);
      }
      archiveDir = resolvedArchive;
      archiveName = path12.basename(resolvedArchive);
      output.stderr.push(green(`  [OK] OpenSpec archive completed: ${archiveDir}`));
      output.stepsOk += 1;
      output.stepsTotal += 1;
      await verifyMainSpecsClean();
      output.stderr.push(green("  [OK] Main specs verified clean"));
      output.stepsOk += 1;
      output.stepsTotal += 1;
      if (designDoc) {
        await annotateFrontmatter(output, designDoc, archiveName, "status: final", false);
      }
      if (planPath) {
        await annotateFrontmatter(output, planPath, archiveName, "", false);
      }
      const archivedProjection = await readClassicState(archiveDir);
      if (!archivedProjection.classic || !archivedProjection.run) {
        throw new ArchiveFailure(red("  [FAIL] archived state projection is incomplete"));
      }
      const artifacts = {
        ...await readArtifacts(archiveDir, archivedProjection.run.artifactsRef),
        archive_directory: archiveDir
      };
      await writeArtifacts(archiveDir, archivedProjection.run.artifactsRef, artifacts);
      const archiveTransition = applyClassicTransition(archivedProjection.classic, "archived");
      const archivedClassic = archiveTransition.classic;
      let transitionedRun = archivedProjection.run;
      if (archivedProjection.run.currentStep !== "completed" || archivedProjection.run.status !== "completed") {
        transitionedRun = await transitionClassicRuntimeRun(
          archiveDir,
          archivedClassic,
          archivedProjection.run,
          {
            actionId,
            archiveDirectory: archiveDir,
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
        await annotateFrontmatter(output, designDoc, archiveName, "status: final", true);
      }
      if (planPath) {
        await annotateFrontmatter(output, planPath, archiveName, "", true);
      }
      output.stderr.push(
        yellow(`  [DRY-RUN] Would set archived: true in ${archiveDir}/.comet.yaml`)
      );
      output.stepsOk += 1;
      output.stepsTotal += 1;
    }
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
var import_yaml4 = __toESM(require_dist(), 1);
import { spawnSync as spawnSync2 } from "child_process";
import { createHash as createHash4 } from "crypto";
import { existsSync, promises as fs13, readFileSync } from "fs";
import path14 from "path";

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
var import_yaml3 = __toESM(require_dist(), 1);
import { promises as fs12 } from "fs";
import path13 from "path";
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
  isolation: ["branch", "worktree"],
  verify_mode: ["light", "full"],
  auto_transition: ["true", "false"],
  verify_result: ["pending", "pass", "fail"],
  branch_status: ["pending", "handled"],
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
async function exists3(file) {
  try {
    await fs12.access(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
function text(value) {
  if (value === null || value === void 0) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
var classicValidateCommand = async (args) => {
  const name = args[0];
  const nameError = openSpecChangeNameError(name);
  if (nameError) {
    return {
      exitCode: 1,
      stderr: color(RED2, `ERROR: ${nameError}`)
    };
  }
  const { directory, label } = await resolveClassicChangeDirectory(name);
  const yamlFile = path13.join(directory, ".comet.yaml");
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
    source = await fs12.readFile(yamlFile, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      fail3(".comet.yaml does not exist");
      lines.push("", color(RED2, `${errors} error(s), ${warnings} warning(s) — validation FAILED`));
      return { exitCode: 1, stderr: lines.join("\n") };
    }
    throw error;
  }
  const document = (0, import_yaml3.parseDocument)(source);
  if (document.errors.length > 0 || !(0, import_yaml3.isMap)(document.contents)) {
    for (const error of document.errors) fail3(error.message);
    if (!(0, import_yaml3.isMap)(document.contents)) fail3("document root must be a mapping");
    lines.push("", color(RED2, `${errors} error(s), ${warnings} warning(s) — validation FAILED`));
    return { exitCode: 1, stderr: lines.join("\n") };
  }
  const record = document.toJS();
  for (const field2 of REQUIRED) {
    if (!Object.prototype.hasOwnProperty.call(record, field2)) {
      fail3(`missing required field '${field2}'`);
    }
  }
  for (const [field2, values] of Object.entries(ENUMS)) {
    if (!Object.prototype.hasOwnProperty.call(record, field2)) continue;
    const value = text(record[field2]);
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
  for (const field2 of ["design_doc", "plan", "handoff_context"]) {
    const value = text(record[field2]);
    if (value && !await exists3(path13.resolve(value))) {
      fail3(`${field2}='${value}' does not exist on disk`);
    }
  }
  for (const field2 of ["handoff_hash"]) {
    const value = text(record[field2]);
    if (value && !/^[a-f0-9]{64}$/u.test(value)) {
      fail3(`${field2}='${value}' is not a sha256 hex digest`);
    }
  }
  for (const field2 of Object.keys(record)) {
    if (!KNOWN_KEYS2.has(field2)) warn(`unknown field '${field2}' found`);
  }
  lines.push("");
  if (errors > 0) {
    lines.push(color(RED2, `${errors} error(s), ${warnings} warning(s) — validation FAILED`));
    return { exitCode: 1, stderr: lines.join("\n") };
  }
  lines.push(color(GREEN2, `0 errors, ${warnings} warning(s) — validation PASSED`));
  return { exitCode: 0, stderr: lines.join("\n") };
};

// domains/comet-classic/classic-guard.ts
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
async function exists4(file) {
  try {
    await fs13.access(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function nonempty(file) {
  try {
    return (await fs13.stat(file)).size > 0;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
function validateChangeName2(name) {
  const error = openSpecChangeNameError(name);
  if (error) throw new GuardFailure(red2(`ERROR: ${error}`));
}
async function resolveChangeDir(name) {
  return (await resolveClassicChangeDirectory(name)).label;
}
function stripInlineComment(value) {
  let out = "";
  let quote = "";
  for (let i = 0; i < value.length; i += 1) {
    const c = value[i];
    if (quote === "") {
      if (c === '"' || c === "'") {
        quote = c;
      } else if (c === "#" && (i === 0 || /\s/u.test(value[i - 1]))) {
        return out.replace(/\s+$/u, "");
      }
    } else if (c === quote) {
      quote = "";
    }
    out += c;
  }
  return out;
}
function stripWrappingQuotes(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}
async function readField(changeDir, field2) {
  const file = path14.join(changeDir, ".comet.yaml");
  const document = (0, import_yaml4.parseDocument)(await fs13.readFile(file, "utf8"), { uniqueKeys: false });
  if (document.errors.length > 0) {
    throw new GuardFailure(`ERROR: Invalid .comet.yaml: ${document.errors[0].message}`);
  }
  const record = document.toJS();
  const value = record[field2];
  if (value === null || value === void 0) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
async function projectConfigValue(field2, changeDir) {
  const changeValue = await readField(changeDir, field2);
  if (changeValue && changeValue !== "null") return changeValue;
  for (const config of [".comet/config.yaml"]) {
    if (!await exists4(config)) continue;
    for (const line of (await fs13.readFile(config, "utf8")).split(/\r?\n/u)) {
      if (new RegExp(`^${field2}:`, "u").test(line)) {
        const value = stripWrappingQuotes(
          stripInlineComment(line.replace(new RegExp(`^${field2}:\\s*`, "u"), ""))
        );
        if (value && value !== "null") return value;
      }
    }
  }
  return "";
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
  const source = stripFencedCodeBlocks(await fs13.readFile(file, "utf8"));
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
function hashFile(file) {
  return createHash4("sha256").update(readFileSync(file)).digest("hex");
}
async function handoffSourceFiles(changeDir) {
  const files = [`${changeDir}/proposal.md`, `${changeDir}/design.md`, `${changeDir}/tasks.md`];
  const specs = `${changeDir}/specs`;
  if (await exists4(specs)) {
    for (const entry2 of (await fs13.readdir(specs)).sort()) {
      const spec = `${specs}/${entry2}/spec.md`;
      if (await exists4(spec)) files.push(spec);
    }
  }
  return files;
}
async function computeHandoffHash(changeDir) {
  const lines = [];
  for (const file of await handoffSourceFiles(changeDir)) {
    if (await exists4(file)) {
      lines.push(`path:${file}`, `sha256:${hashFile(file)}`);
    }
  }
  return createHash4("sha256").update(lines.join("\n")).digest("hex");
}
async function preflight(changeDir, name) {
  if (!await exists4(changeDir)) {
    throw new GuardFailure(red2(`FATAL: change directory not found: ${changeDir}`));
  }
  if (!await exists4(path14.join(changeDir, ".comet.yaml"))) {
    throw new GuardFailure(red2(`FATAL: .comet.yaml not found in ${changeDir}`));
  }
  const result3 = await classicValidateCommand([name], { json: false });
  if (result3.exitCode !== 0) {
    if (result3.stderr)
      process.stderr.write(result3.stderr.endsWith("\n") ? result3.stderr : `${result3.stderr}
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
      const result3 = await run();
      return {
        description,
        passed: result3.passed,
        detail: ("detail" in result3 ? result3.detail : "") ?? ""
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
function pass() {
  return { passed: true };
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
async function removedProjectCommandField(field2) {
  const config = path14.join(".comet", "config.yaml");
  if (!await exists4(config)) return false;
  const document = (0, import_yaml4.parseDocument)(await fs13.readFile(config, "utf8"));
  if (document.errors.length > 0) {
    throw new Error(
      `.comet/config.yaml is invalid YAML (${document.errors[0].message}); cannot check for removed "${field2}" field. Fix the config and retry.`
    );
  }
  const value = document.toJS();
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, field2);
}
function removedProjectCommandRun(field2) {
  return {
    status: 1,
    output: `${field2} has been removed from .comet/config.yaml. Delete this field and run any required ${field2 === "build_command" ? "build" : "verification"} command manually before retrying.`
  };
}
function runInferred(command) {
  const result3 = spawnSync2(command, { shell: true, encoding: "utf8", timeout: 3e5 });
  return {
    status: result3.status ?? 1,
    output: `${result3.stdout ?? ""}${result3.stderr ?? ""}`.replace(/\n+$/u, "")
  };
}
async function buildPasses() {
  if (process.env.COMET_SKIP_BUILD === "1") return { status: 0, output: "" };
  if (await removedProjectCommandField("build_command")) {
    return removedProjectCommandRun("build_command");
  }
  if (await exists4("package.json") && /"build"/u.test(await fs13.readFile("package.json", "utf8"))) {
    return runInferred("npm run build");
  }
  if (await exists4("pom.xml")) {
    if (process.platform === "win32") {
      if (existsSync("mvnw.cmd")) return runInferred("mvnw.cmd compile -q");
      return runInferred("mvn.cmd compile -q");
    }
    if (existsSync("mvnw")) return runInferred("./mvnw compile -q");
    return runInferred("mvn compile -q");
  }
  if (await exists4("Cargo.toml")) return runInferred("cargo build");
  return { status: 1, output: "" };
}
async function verificationCommandPasses() {
  if (process.env.COMET_SKIP_BUILD === "1") return { status: 0, output: "" };
  if (await removedProjectCommandField("verify_command")) {
    return removedProjectCommandRun("verify_command");
  }
  return buildPasses();
}
async function tasksAllDone(changeDir) {
  const tasks = path14.join(changeDir, "tasks.md");
  if (!await exists4(tasks)) {
    return fail(
      `tasks.md is missing at ${tasks}
Next: restore or create tasks.md for this change before leaving build.`
    );
  }
  const source = await fs13.readFile(tasks, "utf8");
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
  const tasks = path14.join(changeDir, "tasks.md");
  if (!await exists4(tasks)) return false;
  return /- \[/u.test(await fs13.readFile(tasks, "utf8"));
}
async function planTasksAllDone(changeDir) {
  const plan = await readField(changeDir, "plan");
  if (!plan || plan === "null") return pass();
  if (!await exists4(plan)) {
    return fail(
      `plan file is missing at ${plan}
Next: restore the Superpowers plan file or update .comet.yaml plan before leaving build.`
    );
  }
  const source = await fs13.readFile(plan, "utf8");
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
async function isolationSelected(changeDir, change) {
  const isolation = await readField(changeDir, "isolation");
  if (isolation === "branch" || isolation === "worktree") return pass();
  return fail(
    `isolation must be branch or worktree, got '${isolation || "null"}'
Next: ask the user to choose branch or worktree, create the chosen isolation, then run:
  node "$COMET_STATE" set ${change} isolation <branch|worktree>`
  );
}
async function buildModeSelected(changeDir, change) {
  const buildMode = await readField(changeDir, "build_mode");
  if (["subagent-driven-development", "executing-plans", "direct"].includes(buildMode))
    return pass();
  return fail(
    `build_mode must be selected before leaving build, got '${buildMode || "null"}'
Next: ask the user to choose an execution mode, then run:
  node "$COMET_STATE" set ${change} build_mode <subagent-driven-development|executing-plans>`
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
  node "$COMET_STATE" set ${change} subagent_dispatch confirmed
Or ask the user to switch to executing-plans and run:
  node "$COMET_STATE" set ${change} build_mode executing-plans`
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
  node "$COMET_STATE" set ${change} tdd_mode <tdd|direct>`
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
  node "$COMET_STATE" set ${change} review_mode <off|standard|thorough>`
  );
}
async function verificationReportExists(changeDir) {
  const report = await readField(changeDir, "verification_report");
  return Boolean(report) && report !== "null" && existsSync(report);
}
async function branchStatusHandled(changeDir) {
  return await readField(changeDir, "branch_status") === "handled";
}
async function archivedIsTrue(changeDir) {
  return await readField(changeDir, "archived") === "true";
}
async function designDocFrontmatterHas(designDoc, field2, expected) {
  const source = (await fs13.readFile(designDoc, "utf8")).replace(/^\uFEFF/u, "");
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
  if (designDoc && designDoc !== "null" && existsSync(designDoc)) return pass();
  return fail(
    `design_doc must point to an existing Superpowers Design Doc for full workflow before leaving design.
Next: create the Design Doc and run: node "$COMET_STATE" set ${change} design_doc <path>`
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
Next: regenerate the design handoff with comet-handoff.mjs.`
    );
  }
  if (!/^[a-f0-9]{64}$/u.test(recordedHash)) {
    return fail(
      `handoff_hash is missing or invalid: ${recordedHash || "null"}
Next: regenerate the design handoff with comet-handoff.mjs.`
    );
  }
  const actualHash = await computeHandoffHash(changeDir);
  if (actualHash !== recordedHash) {
    return fail(
      `OpenSpec artifacts changed after handoff was generated.
Expected handoff_hash: ${recordedHash}
Actual handoff_hash:   ${actualHash}
Next: rerun comet-handoff.mjs so Superpowers receives the current OpenSpec context.`
    );
  }
  const markdown = `${context.replace(/\.json$/u, "")}.md`;
  if (!await nonempty(markdown)) {
    return fail(
      `design handoff markdown is missing or empty: ${markdown}
Next: regenerate the design handoff with comet-handoff.mjs.`
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
  const source = await fs13.readFile(markdown, "utf8");
  const problems = [];
  if (!/^Generated-by: comet-handoff\.sh$/mu.test(source)) {
    problems.push("handoff markdown is missing Generated-by marker");
  }
  if (!/^- Mode: (compact|full|beta)$/mu.test(source)) {
    problems.push("handoff markdown is missing Mode marker");
  }
  for (const file of await handoffSourceFiles(changeDir)) {
    if (!await exists4(file)) continue;
    if (!new RegExp(`^- Source: ${file}$`, "mu").test(source)) {
      problems.push(`handoff markdown is missing source reference: ${file}`);
    }
    if (!new RegExp(`^- SHA256: ${hashFile(file)}$`, "mu").test(source)) {
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
  const source = await fs13.readFile(context, "utf8");
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
  const record = parsed;
  if (typeof record.change !== "string") problems.push("spec-context.json missing 'change' field");
  if (typeof record.phase !== "string") problems.push("spec-context.json missing 'phase' field");
  if (record.mode !== "beta") problems.push("spec-context.json mode is not beta");
  if (typeof record.context_hash !== "string") {
    problems.push("spec-context.json missing 'context_hash' field");
  }
  if (!Array.isArray(record.files)) problems.push("spec-context.json missing 'files' field");
  const files = Array.isArray(record.files) ? record.files.filter(
    (file) => Boolean(file) && typeof file === "object" && !Array.isArray(file)
  ) : [];
  for (const file of await handoffSourceFiles(changeDir)) {
    if (!await exists4(file)) continue;
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
      async () => await nonempty(path14.join(changeDir, "proposal.md")) ? pass() : fail("")
    ),
    check(
      "proposal.md matches configured language",
      () => documentLanguageMatchesConfigured(changeDir, path14.join(changeDir, "proposal.md"))
    ),
    check(
      "tasks.md exists and non-empty",
      async () => await nonempty(path14.join(changeDir, "tasks.md")) ? pass() : fail("")
    ),
    check(
      "tasks.md matches configured language",
      () => documentLanguageMatchesConfigured(changeDir, path14.join(changeDir, "tasks.md"))
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
        async () => await nonempty(path14.join(changeDir, "design.md")) ? pass() : fail("")
      ),
      check(
        "design.md matches configured language",
        () => documentLanguageMatchesConfigured(changeDir, path14.join(changeDir, "design.md"))
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
      async () => await nonempty(path14.join(changeDir, "proposal.md")) ? pass() : fail("")
    ),
    check(
      "proposal.md matches configured language",
      () => documentLanguageMatchesConfigured(changeDir, path14.join(changeDir, "proposal.md"))
    ),
    check(
      "design.md exists",
      async () => await nonempty(path14.join(changeDir, "design.md")) ? pass() : fail("")
    ),
    check(
      "design.md matches configured language",
      () => documentLanguageMatchesConfigured(changeDir, path14.join(changeDir, "design.md"))
    ),
    check(
      "tasks.md exists",
      async () => await nonempty(path14.join(changeDir, "tasks.md")) ? pass() : fail("")
    ),
    check(
      "tasks.md matches configured language",
      () => documentLanguageMatchesConfigured(changeDir, path14.join(changeDir, "tasks.md"))
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
async function guardBuildChecks(output, changeDir, change) {
  return runChecks(output, [
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
      async () => await nonempty(path14.join(changeDir, "proposal.md")) ? pass() : fail("")
    ),
    check(
      "proposal.md matches configured language",
      () => documentLanguageMatchesConfigured(changeDir, path14.join(changeDir, "proposal.md"))
    ),
    check("Superpowers plan matches configured language", async () => {
      const plan = await readField(changeDir, "plan");
      if (!plan || plan === "null" || !await exists4(plan)) return pass();
      return documentLanguageMatchesConfigured(changeDir, plan);
    }),
    // Build check runs last — only after all config checks pass — to avoid
    // wasting time on a build that would be rejected by a config failure.
    check("Build passes", async () => {
      const buildResult = await buildPasses();
      return buildResult.status === 0 ? pass() : fail(buildResult.output);
    })
  ]);
}
async function guardVerifyChecks(output, changeDir) {
  return runChecks(output, [
    check("tasks.md all tasks checked", () => tasksAllDone(changeDir)),
    // Verification command runs after tasks check — no point running tests
    // if tasks.md is incomplete.
    check("Verification passes", async () => {
      const verifyResult = await verificationCommandPasses();
      return verifyResult.status === 0 ? pass() : fail(verifyResult.output);
    }),
    check(
      "verification_report exists",
      async () => await verificationReportExists(changeDir) ? pass() : fail("")
    ),
    check("verification_report matches configured language", async () => {
      const report = await readField(changeDir, "verification_report");
      if (!report || report === "null" || !await exists4(report)) return pass();
      return documentLanguageMatchesConfigured(changeDir, report);
    }),
    check(
      "branch_status=handled",
      async () => await branchStatusHandled(changeDir) ? pass() : fail("")
    )
  ]);
}
async function guardArchiveChecks(output, changeDir) {
  return runChecks(output, [
    check("archived is true", async () => await archivedIsTrue(changeDir) ? pass() : fail("")),
    check(
      "proposal.md exists",
      async () => await nonempty(path14.join(changeDir, "proposal.md")) ? pass() : fail("")
    ),
    check(
      "design.md exists",
      async () => await nonempty(path14.join(changeDir, "design.md")) ? pass() : fail("")
    ),
    check("tasks.md all tasks checked", () => tasksAllDone(changeDir))
  ]);
}
async function applyStateUpdate(output, change, changeDir, phase, context) {
  const event = CLASSIC_GUARD_TRANSITION_EVENT[phase];
  if (!event) return;
  const result3 = applyClassicTransition(context.classic, event);
  await transitionClassicRuntimeRun(changeDir, result3.classic, context.run, {
    event,
    phase,
    source: "comet-guard"
  });
  await appendClassicStateEvent(changeDir, {
    change,
    event,
    source: "comet-guard",
    from: context.classic,
    to: result3.classic,
    effects: result3.effects
  });
  for (const effect of result3.effects) {
    output.stderr.push(green2(`[SET] ${wireField(effect.field)}=${wireValue(effect.to)}`));
  }
  output.stderr.push(green2(`[TRANSITION] ${event}`));
  const template = APPLY_MESSAGE[phase];
  const message = phase === "open" ? template.replace("PLACEHOLDER", result3.classic.phase) : template;
  output.stderr.push(green2(message));
}
var classicGuardCommand = async (args, options) => {
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
    else if (phase === "build") blocked2 = await guardBuildChecks(output, changeDir, change);
    else if (phase === "verify") blocked2 = await guardVerifyChecks(output, changeDir);
    else blocked2 = await guardArchiveChecks(output, changeDir);
    if (blocked2) {
      output.stderr.push("");
      output.stderr.push(red2("BLOCKED — fix failing checks before proceeding to next phase"));
      return output.toResult(1);
    }
    output.stderr.push("");
    output.stderr.push(green2("ALL CHECKS PASSED — ready for next phase"));
    if (flag === "--apply") {
      await applyStateUpdate(output, change, changeDir, phase, runContext);
    }
    return output.toResult(0);
  } catch (error) {
    if (error instanceof GuardFailure) {
      for (const line of error.message.split("\n")) output.stderr.push(line);
      return output.toResult(error.exitCode);
    }
    throw error;
  }
};

// domains/comet-classic/classic-handoff.ts
var import_yaml5 = __toESM(require_dist(), 1);
import { createHash as createHash5 } from "crypto";
import { promises as fs14, readFileSync as readFileSync2 } from "fs";
import path15 from "path";
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
async function exists5(file) {
  try {
    await fs14.access(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function nonempty2(file) {
  try {
    return (await fs14.stat(file)).size > 0;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
function validateChangeName3(name) {
  const error = openSpecChangeNameError(name);
  if (error) throw new HandoffFailure(red3(`ERROR: ${error}`));
}
function hashFile2(file) {
  return createHash5("sha256").update(readFileSync2(file)).digest("hex");
}
function hashText2(content) {
  return createHash5("sha256").update(content).digest("hex");
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
async function handoffSourceFiles2(changeDir) {
  const files = [`${changeDir}/proposal.md`, `${changeDir}/design.md`, `${changeDir}/tasks.md`];
  const specs = `${changeDir}/specs`;
  if (await exists5(specs)) {
    for (const entry2 of (await fs14.readdir(specs)).sort()) {
      const spec = `${specs}/${entry2}/spec.md`;
      if (await exists5(spec)) files.push(spec);
    }
  }
  return files;
}
async function computeContextHash(changeDir) {
  const lines = [];
  for (const file of await handoffSourceFiles2(changeDir)) {
    if (await exists5(file)) {
      lines.push(`path:${file}`, `sha256:${hashFile2(file)}`);
    }
  }
  return createHash5("sha256").update(lines.join("\n")).digest("hex");
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
async function writeMarkdownContext(changeDir, change, mode, contextHash, output) {
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
  for (const file of await handoffSourceFiles2(changeDir)) {
    if (!await exists5(file)) continue;
    const content = await fs14.readFile(file, "utf8");
    const total = lineCount(content);
    lines.push(
      `## ${file}`,
      "",
      `- Source: ${file}`,
      `- Lines: 1-${total}`,
      `- SHA256: ${hashFile2(file)}`,
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
        `Full source: ${file}`
      );
    }
    lines.push("");
  }
  await fs14.writeFile(output, lines.join("\n"));
}
async function writeJsonContext(changeDir, change, mode, contextHash, output) {
  const entries = [];
  for (const file of await handoffSourceFiles2(changeDir)) {
    if (!await exists5(file)) continue;
    entries.push(`    { "path": "${jsonEscape(file)}", "sha256": "${hashFile2(file)}" }`);
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
  await fs14.writeFile(output, document);
}
async function writeSpecProjectionForFile(file, content) {
  return [
    `## ${file}`,
    "",
    `- Source: ${file}`,
    `- Lines: 1-${lineCount(content)}`,
    `- SHA256: ${hashFile2(file)}`,
    "",
    "```md",
    content,
    "```",
    ""
  ];
}
async function writeSpecMarkdownContext(changeDir, change, contextHash, output) {
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
  for (const file of await handoffSourceFiles2(changeDir)) {
    if (!await exists5(file)) continue;
    lines.push(`- Source: ${file}`, `- SHA256: ${hashFile2(file)}`);
  }
  lines.push("", "## Acceptance Projection", "");
  const specs = `${changeDir}/specs`;
  let projected = false;
  if (await exists5(specs)) {
    for (const entry2 of (await fs14.readdir(specs)).sort()) {
      const spec = `${specs}/${entry2}/spec.md`;
      if (!await exists5(spec)) continue;
      projected = true;
      lines.push(...await writeSpecProjectionForFile(spec, await fs14.readFile(spec, "utf8")));
    }
  }
  if (!projected) {
    lines.push("No delta spec files found.", "");
  }
  lines.push(
    "Full source files remain canonical. If a required heading or scenario is missing here, regenerate the handoff or read the source spec directly. Supporting files (proposal, design, tasks) are referenced by hash only."
  );
  await fs14.writeFile(output, lines.join("\n"));
}
async function writeSpecJsonContext(changeDir, change, contextHash, output) {
  const entries = [];
  for (const file of await handoffSourceFiles2(changeDir)) {
    if (!await exists5(file)) continue;
    const role = /\/specs\/[^/]+\/spec\.md$/u.test(file) ? "spec" : "supporting";
    entries.push({ path: file, sha256: hashFile2(file), role });
  }
  await fs14.writeFile(
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
`
  );
}
async function readField2(changeDir, field2) {
  const file = path15.join(changeDir, ".comet.yaml");
  const document = (0, import_yaml5.parseDocument)(await fs14.readFile(file, "utf8"), { uniqueKeys: false });
  if (document.errors.length > 0) {
    throw new HandoffFailure(`ERROR: Invalid .comet.yaml: ${document.errors[0].message}`);
  }
  const record = document.toJS();
  const value = record[field2];
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
async function completedHandoffIsCurrent(changeDir, run, contextHash, contextJson, contextMd) {
  const [context, artifacts, checkpoint] = await Promise.all([
    readContext(changeDir, run.contextRef),
    readArtifacts(changeDir, run.artifactsRef),
    readCheckpoint(changeDir, run.checkpointRef)
  ]);
  if (!await exists5(contextJson) || !await exists5(contextMd)) return false;
  if (context !== await fs14.readFile(contextMd, "utf8")) return false;
  if (artifacts.handoff_context !== contextJson || artifacts.handoff_markdown !== contextMd) {
    return false;
  }
  return checkpoint?.runId === run.runId && checkpoint.contextHash === (context === null ? null : hashText2(context)) && checkpoint.artifactsHash === artifactsHash2(artifacts) && contextHash.length === 64;
}
var classicHandoffCommand = async (args) => {
  const output = new HandoffOutput();
  const [change, phase, mode, fullFlag] = args;
  try {
    validateChangeName3(change);
    const changeDir = `openspec/changes/${change}`;
    if (phase === "--hash-only") {
      if (!await exists5(changeDir)) {
        throw new HandoffFailure(red3(`ERROR: change directory not found: ${changeDir}`));
      }
      for (const required2 of ["proposal.md", "design.md", "tasks.md"]) {
        if (!await nonempty2(`${changeDir}/${required2}`)) {
          throw new HandoffFailure(
            red3(`ERROR: required file missing or empty: ${changeDir}/${required2}`)
          );
        }
      }
      output.stdout.push(await computeContextHash(changeDir));
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
    const yaml = `${changeDir}/.comet.yaml`;
    if (!await exists5(changeDir)) {
      throw new HandoffFailure(red3(`ERROR: change directory not found: ${changeDir}`));
    }
    if (!await exists5(yaml)) {
      throw new HandoffFailure(red3(`ERROR: .comet.yaml not found at ${yaml}`));
    }
    if (await readField2(changeDir, "phase") !== "design") {
      throw new HandoffFailure(red3("ERROR: design handoff requires phase: design"));
    }
    for (const required2 of ["proposal.md", "design.md", "tasks.md"]) {
      if (!await nonempty2(`${changeDir}/${required2}`)) {
        throw new HandoffFailure(
          red3(`ERROR: required OpenSpec artifact missing or empty: ${changeDir}/${required2}`)
        );
      }
    }
    const handoffDir = `${changeDir}/.comet/handoff`;
    const contextCompression2 = await readField2(changeDir, "context_compression") || "off";
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
    const contextHash = await computeContextHash(changeDir);
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
    const runtime = await ensureClassicRuntimeRun(changeDir);
    const pendingAction = await readPendingAction(changeDir, runtime.run.pendingRef);
    const resumesPending = pendingAction?.id === actionId && pendingAction.type === "handoff" && pendingAction.ref === contextHash;
    if (runtime.run.pending && runtime.run.pending !== actionId) {
      throw new HandoffFailure(red3(`ERROR: another action is pending: ${runtime.run.pending}`));
    }
    if (runtime.classic.handoffHash === contextHash && runtime.classic.handoffContext === contextJson && !runtime.run.pending && !pendingAction && await completedHandoffIsCurrent(changeDir, runtime.run, contextHash, contextJson, contextMd)) {
      output.stderr.push(green3(`[HANDOFF] wrote ${contextJson}`));
      output.stderr.push(green3(`[HANDOFF] wrote ${contextMd}`));
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
    await fs14.mkdir(handoffDir, { recursive: true });
    if (handoffMode === "beta") {
      await writeSpecMarkdownContext(changeDir, change, contextHash, contextMd);
      await writeSpecJsonContext(changeDir, change, contextHash, contextJson);
    } else {
      await writeMarkdownContext(changeDir, change, handoffMode, contextHash, contextMd);
      await writeJsonContext(changeDir, change, handoffMode, contextHash, contextJson);
    }
    const context = await fs14.readFile(contextMd, "utf8");
    await writeContext(changeDir, pendingRun.contextRef, context);
    const artifacts = {
      ...await readArtifacts(changeDir, pendingRun.artifactsRef),
      handoff_context: contextJson,
      handoff_markdown: contextMd
    };
    await writeArtifacts(changeDir, pendingRun.artifactsRef, artifacts);
    const completedClassic = {
      ...runtime.classic,
      handoffContext: contextJson,
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
    output.stderr.push(green3(`[HANDOFF] wrote ${contextJson}`));
    output.stderr.push(green3(`[HANDOFF] wrote ${contextMd}`));
    output.stderr.push(green3(`[HANDOFF] handoff_hash=${contextHash}`));
    return output.toResult(0);
  } catch (error) {
    if (error instanceof HandoffFailure) {
      for (const line of error.message.split("\n")) output.stderr.push(line);
      return output.toResult(error.exitCode);
    }
    throw error;
  }
};

// domains/comet-classic/classic-hook-guard.ts
import { existsSync as existsSync2, promises as fs15, readFileSync as readFileSync3 } from "fs";
import path16 from "path";
function result(exitCode, message) {
  return { exitCode, stderr: message + "\n" };
}
function allowed(message) {
  return result(0, `[COMET-HOOK] allowed: ${message}`);
}
function inputTarget() {
  if (process.env.FILE_PATH) return process.env.FILE_PATH;
  if (process.stdin.isTTY) return "";
  const input = readFileSync3(0, "utf8");
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
function parseProjectRoot(args) {
  const index = args.indexOf("--project-root");
  const value = index >= 0 ? args[index + 1] : void 0;
  return path16.resolve(value && !value.startsWith("--") ? value : process.cwd());
}
function relativeToProjectRoot(target, projectRoot) {
  const relative = normalized(path16.relative(projectRoot, target));
  if (relative === "") return "";
  if (relative.startsWith("../") || relative === ".." || path16.isAbsolute(relative)) return null;
  return relative;
}
async function physicalPathForPossiblyMissingTarget(target) {
  const resolved = path16.resolve(target);
  const root = path16.parse(resolved).root;
  const missingSegments = [];
  let cursor = resolved;
  while (cursor && cursor !== root) {
    try {
      const physicalBase = await fs15.realpath(cursor);
      return path16.join(physicalBase, ...missingSegments.reverse());
    } catch (error) {
      const code = error.code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      missingSegments.push(path16.basename(cursor));
      cursor = path16.dirname(cursor);
    }
  }
  try {
    const physicalRoot = await fs15.realpath(root);
    return path16.join(physicalRoot, ...missingSegments.reverse());
  } catch {
    return null;
  }
}
async function projectRelative(target, projectRoot) {
  const rawCandidate = path16.isAbsolute(target) ? target : path16.resolve(process.cwd(), target);
  let candidate = normalized(rawCandidate);
  const rootRelative = relativeToProjectRoot(rawCandidate, projectRoot);
  if (rootRelative !== null) return rootRelative;
  try {
    const physicalCandidate = await physicalPathForPossiblyMissingTarget(rawCandidate);
    const physicalRoot = await fs15.realpath(projectRoot);
    if (physicalCandidate) {
      const physicalRootRelative = relativeToProjectRoot(physicalCandidate, physicalRoot);
      if (physicalRootRelative !== null) return physicalRootRelative;
      candidate = normalized(physicalCandidate);
    }
  } catch {
    if (!path16.isAbsolute(target)) return normalized(target).replace(/^\.\//u, "");
  }
  return candidate.replace(/^\.\//u, "");
}
async function loadGoverningChange(changeDir) {
  try {
    const runtime = await ensureStrictClassicRuntimeRun(changeDir);
    return {
      changeDir,
      phase: runtime.classic.phase,
      classic: runtime.classic,
      archived: runtime.classic.archived
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
  const changesDir = path16.join(projectRoot, "openspec", "changes");
  const governingChanges = [];
  if (!existsSync2(changesDir)) return governingChanges;
  for (const entry2 of (await fs15.readdir(changesDir, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name)
  )) {
    if (!entry2.isDirectory() || entry2.name === "archive") continue;
    const changeDir = path16.join(changesDir, entry2.name);
    if (!existsSync2(path16.join(changeDir, ".comet.yaml"))) continue;
    const governing = await loadGoverningChange(changeDir);
    if (!governing || governing.archived) continue;
    governingChanges.push(governing);
  }
  return governingChanges;
}
function blocksSourceWrites(governing) {
  if (governing.phase === "open" || governing.phase === "design" || governing.phase === "archive") {
    return true;
  }
  return governing.phase === "build" && governing.classic?.workflow === "full" && !governing.classic.designDoc;
}
function isSuperpowersArtifactPath(relativePath2) {
  return relativePath2.startsWith("docs/superpowers/");
}
function allowsSuperpowersArtifacts(governing) {
  return governing.phase === "design" || governing.phase === "build" || governing.phase === "verify";
}
function governingChangeName(governing) {
  return governing.changeDir ? path16.basename(governing.changeDir) : null;
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
    (artifactPath) => artifactPath && normalized(artifactPath) === relativePath2
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
  if (recorded) return recorded;
  const eligible = active.filter(allowsSuperpowersArtifacts);
  const named = eligible.filter((governing) => {
    const name = governingChangeName(governing);
    return name !== null && matchesSuperpowersArtifactName(relativePath2, name);
  }).sort(
    (a, b) => (governingChangeName(b)?.length ?? 0) - (governingChangeName(a)?.length ?? 0)
  )[0];
  if (named) return named;
  return null;
}
async function repoSourceGoverningChange(projectRoot) {
  const active = await activeChanges(projectRoot);
  return active.find(blocksSourceWrites) ?? active[0] ?? null;
}
async function governingChange(relativePath2, projectRoot) {
  const prefix = "openspec/changes/";
  if (relativePath2.startsWith(prefix)) {
    const rest = relativePath2.slice(prefix.length);
    const [name] = rest.split("/");
    if (name && name !== "archive") {
      const changeDir = path16.join(projectRoot, "openspec", "changes", name);
      const stateFile2 = path16.join(changeDir, ".comet.yaml");
      if (existsSync2(stateFile2)) {
        const governing = await loadGoverningChange(changeDir);
        if (governing) return governing;
        return { changeDir, phase: "open", classic: null, archived: false };
      }
      return { changeDir, phase: "open", classic: null, archived: false };
    }
  }
  if (isSuperpowersArtifactPath(relativePath2)) {
    const superpowers = await superpowersArtifactGoverningChange(relativePath2, projectRoot);
    if (superpowers) return { ...superpowers, superpowersArtifact: "matched" };
    const fallback = await repoSourceGoverningChange(projectRoot);
    return fallback ? { ...fallback, superpowersArtifact: "unmatched" } : null;
  }
  return repoSourceGoverningChange(projectRoot);
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
function openSpecAllowed(relativePath2, phase) {
  if (!relativePath2.startsWith("openspec/")) return null;
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
    "  NEXT: finish the Design Doc, then run comet-guard design --apply to enter build"
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
function blockedUnmatchedSuperpowersArtifact(relativePath2, phase) {
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
      "  BLOCKED: unmatched Superpowers artifact",
      "  This docs/superpowers/ path does not match any active change artifact",
      "  NEXT: record the artifact path in .comet.yaml or include the change name in the artifact filename",
      ""
    ].join("\n")
  );
}
var classicHookGuardCommand = async (args) => {
  const projectRoot = parseProjectRoot(args);
  const target = inputTarget();
  if (!target) return allowed("no file path in tool input");
  const relativePath2 = await projectRelative(target, projectRoot);
  let governing;
  try {
    governing = await governingChange(relativePath2, projectRoot);
  } catch (error) {
    return result(
      2,
      `[COMET-HOOK] blocked: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!governing) return allowed("no active comet change");
  if (governing.archived) return allowed(`${relativePath2} (own change archived)`);
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
  const phase = governing.phase;
  const openSpec = openSpecAllowed(relativePath2, phase);
  if (openSpec) return allowed(openSpec);
  if (isSuperpowersArtifactPath(relativePath2)) {
    if (governing.superpowersArtifact === "matched" && allowsSuperpowersArtifacts(governing)) {
      return allowed(`${relativePath2} (phase: ${phase}, superpowers)`);
    }
    if (governing.superpowersArtifact === "unmatched") {
      return blockedUnmatchedSuperpowersArtifact(relativePath2, phase);
    }
  }
  if (phase === "build" && governing.classic?.workflow === "full" && !governing.classic.designDoc) {
    return blockedMissingDesignDoc(relativePath2);
  }
  if (phase === "build" || phase === "verify") {
    return allowed(`${relativePath2} (phase: ${phase})`);
  }
  return blocked(relativePath2, phase);
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
function isRecord(value) {
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
  if (!isRecord(input)) throw new CometIntentValidationError(["frame must be an object"]);
  const intent = isRecord(input.intent) ? input.intent : {};
  if (!isRecord(input.intent)) issues.push("intent must be an object");
  const slots = isRecord(input.slots) ? input.slots : {};
  if (!isRecord(input.slots)) issues.push("slots must be an object");
  const context = isRecord(input.context) ? input.context : {};
  if (!isRecord(input.context)) issues.push("context must be an object");
  const proposedRouteInput = isRecord(input.proposed_route) ? input.proposed_route : {};
  if (!isRecord(input.proposed_route)) issues.push("proposed_route must be an object");
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
      const record = isRecord(entity) ? entity : {};
      if (!isRecord(entity)) issues.push(`entities[${index}] must be an object`);
      return {
        type: enumValue2(record.type, ENTITY_TYPES, `entities[${index}].type`, issues) ?? "risk_signal",
        value: stringValue(record.value, `entities[${index}].value`, issues),
        text: stringValue(record.text, `entities[${index}].text`, issues)
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
      active_change_names: isRecord(context) ? (() => {
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
      const record = isRecord(item) ? item : {};
      if (!isRecord(item)) issues.push(`evidence[${index}] must be an object`);
      return {
        field: stringValue(record.field, `evidence[${index}].field`, issues),
        quote: stringValue(record.quote, `evidence[${index}].quote`, issues),
        source: enumValue2(record.source, EVIDENCE_SOURCES, `evidence[${index}].source`, issues) ?? "user"
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

// domains/comet-classic/classic-state-command.ts
var import_yaml6 = __toESM(require_dist(), 1);
import { spawnSync as spawnSync3 } from "child_process";
import { randomUUID as randomUUID6 } from "crypto";
import { existsSync as existsSync3, promises as fs16 } from "fs";
import path17 from "path";
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
  "classic_profile",
  "classic_migration"
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
  isolation: ["branch", "worktree"],
  verify_mode: ["light", "full"],
  auto_transition: ["true", "false"],
  verify_result: ["pending", "pass", "fail"],
  branch_status: ["pending", "handled"],
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
  verifyResult: "verify_result",
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
async function exists6(file) {
  try {
    await fs16.access(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function nonempty3(file) {
  try {
    return (await fs16.stat(file)).size > 0;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function changeDirectory(name) {
  return resolveClassicChangeDirectory(name);
}
async function readDocument2(file) {
  let source;
  try {
    source = await fs16.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      fail2(
        `ERROR: .comet.yaml not found at ${path17.relative(process.cwd(), file).replaceAll("\\", "/")}`
      );
    }
    throw error;
  }
  const document = (0, import_yaml6.parseDocument)(source, { uniqueKeys: false });
  if (document.errors.length > 0) fail2(`ERROR: Invalid .comet.yaml: ${document.errors[0].message}`);
  return document;
}
async function atomicWrite2(file, content) {
  await fs16.mkdir(path17.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID6()}.tmp`;
  try {
    await fs16.writeFile(temporary, content, "utf8");
    await fs16.rename(temporary, file);
  } catch (error) {
    await fs16.rm(temporary, { force: true });
    throw error;
  }
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
function enumRecordValue(record, field2, values, fallback) {
  const value = record[field2];
  return typeof value === "string" && values.includes(value) ? value : fallback;
}
function nullableRecordString(record, field2) {
  const value = record[field2];
  if (value === null || value === void 0 || value === "") return null;
  return typeof value === "string" ? value : String(value);
}
function nullableRecordBoolean(record, field2) {
  const value = record[field2];
  if (value === null || value === void 0 || value === "") return null;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}
function sparseClassicState(record) {
  const workflow = enumRecordValue(record, "workflow", PROFILES, "full");
  return {
    workflow,
    language: enumRecordValue(record, "language", ARTIFACT_LANGUAGES2, null),
    phase: enumRecordValue(record, "phase", PHASES3, "open"),
    contextCompression: enumRecordValue(
      record,
      "context_compression",
      ["off", "beta"],
      null
    ),
    buildMode: enumRecordValue(
      record,
      "build_mode",
      ["subagent-driven-development", "executing-plans", "direct"],
      null
    ),
    buildPause: enumRecordValue(record, "build_pause", ["plan-ready"], null),
    subagentDispatch: enumRecordValue(record, "subagent_dispatch", ["confirmed"], null),
    tddMode: enumRecordValue(record, "tdd_mode", ["tdd", "direct"], null),
    reviewMode: enumRecordValue(
      record,
      "review_mode",
      ["off", "standard", "thorough"],
      null
    ),
    isolation: enumRecordValue(record, "isolation", ["branch", "worktree"], null),
    verifyMode: enumRecordValue(record, "verify_mode", ["light", "full"], null),
    autoTransition: nullableRecordBoolean(record, "auto_transition"),
    baseRef: nullableRecordString(record, "base_ref"),
    designDoc: nullableRecordString(record, "design_doc"),
    plan: nullableRecordString(record, "plan"),
    verifyResult: enumRecordValue(
      record,
      "verify_result",
      ["pending", "pass", "fail"],
      "pending"
    ),
    verificationReport: nullableRecordString(record, "verification_report"),
    branchStatus: enumRecordValue(record, "branch_status", ["pending", "handled"], null),
    createdAt: nullableRecordString(record, "created_at"),
    verifiedAt: nullableRecordString(record, "verified_at"),
    archived: nullableRecordBoolean(record, "archived") ?? false,
    directOverride: nullableRecordBoolean(record, "direct_override"),
    handoffContext: nullableRecordString(record, "handoff_context"),
    handoffHash: nullableRecordString(record, "handoff_hash"),
    classicProfile: enumRecordValue(record, "classic_profile", PROFILES, workflow),
    classicMigration: typeof record.classic_migration === "number" ? record.classic_migration : null
  };
}
async function projectConfigValue2(field2) {
  const file = path17.resolve(".comet", "config.yaml");
  if (!await exists6(file)) return null;
  const document = await readDocument2(file);
  const value = document.get(field2);
  return value === null || value === void 0 ? null : scalar(value);
}
async function projectLanguageDefault() {
  if (process.env.COMET_LANGUAGE)
    return validateLanguage(process.env.COMET_LANGUAGE, "COMET_LANGUAGE");
  const value = await projectConfigValue2("language");
  if (value) return validateLanguage(value, ".comet/config.yaml");
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
  const result3 = spawnSync3("git", args, { encoding: "utf8" });
  return result3.status === 0 ? result3.stdout.trim() : null;
}
async function stateFile(name) {
  const change = await changeDirectory(name);
  return {
    ...change,
    file: path17.join(change.directory, ".comet.yaml")
  };
}
async function readField3(name, field2) {
  const { file } = await stateFile(name);
  const document = await readDocument2(file);
  const record = document.toJS();
  const value = record[field2];
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
  const document = (0, import_yaml6.parseDocument)(`${field2}: ${value}
`);
  if (document.errors.length > 0) fail2(`ERROR: Invalid value: '${value}'`);
  return document.get(field2);
}
function validateSetValue(field2, value) {
  if (field2 === "language") {
    validateLanguage(value, "language");
    return;
  }
  const enumValues = FIELD_ENUMS[field2];
  if (enumValues) validateEnum(value, enumValues);
  if (PATH_FIELDS.has(field2)) validateRelativePath(value, field2);
  if ((field2 === "skill_hash" || field2 === "handoff_hash") && !/^[a-f0-9]{64}$/u.test(value)) {
    fail2(`ERROR: ${field2} must be a sha256 hex digest`);
  }
  if (field2 === "iteration" && !/^[0-9]+$/u.test(value)) {
    fail2("ERROR: iteration must be a non-negative integer");
  }
}
async function setField2(output, name, field2, value, options = {}) {
  if (MACHINE_OWNED_FIELDS.has(field2) && !options.machineOwned) {
    fail2(`ERROR: '${field2}' is a machine-owned Run field and cannot be set directly`);
  }
  if (!SETTABLE_FIELDS.has(field2) && !MACHINE_OWNED_FIELDS.has(field2)) {
    fail2(`ERROR: Unknown field: '${field2}'`);
  }
  if (field2 === "phase" && !options.internal && process.env.COMET_FORCE_PHASE !== "1") {
    fail2(
      "ERROR: Setting 'phase' directly is not allowed; it bypasses state machine evidence checks.\n  Use: comet-state.mjs transition <change-name> <event>\n  Repair-only escape hatch: COMET_FORCE_PHASE=1 comet-state.mjs set <change-name> phase <value>"
    );
  }
  validateSetValue(field2, value);
  const { file, directory } = await stateFile(name);
  const document = await readDocument2(file);
  document.set(field2, parsedValue(field2, value));
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
    await atomicWrite2(file, document.toString());
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
  const { file, label, directory } = await stateFile(name);
  if (await exists6(file)) fail2(`ERROR: .comet.yaml already exists at ${label}/.comet.yaml`);
  await fs16.mkdir(directory, { recursive: true });
  const preset = workflow !== "full";
  const reviewMode = preset ? "off" : await reviewModeDefault();
  const document = new import_yaml6.Document({
    workflow,
    language: await projectLanguageDefault(),
    phase: "open",
    context_compression: await contextCompression(),
    build_mode: preset ? "direct" : null,
    build_pause: null,
    subagent_dispatch: null,
    tdd_mode: preset ? "direct" : null,
    review_mode: reviewMode,
    isolation: preset ? "branch" : null,
    verify_mode: preset ? "light" : null,
    auto_transition: await autoTransition() === "true",
    base_ref: gitOutput(["rev-parse", "--verify", "HEAD"]),
    design_doc: null,
    plan: null,
    verify_result: "pending",
    verification_report: null,
    branch_status: "pending",
    created_at: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
    verified_at: null,
    archived: false
  });
  await atomicWrite2(file, document.toString());
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
  if (!["branch", "worktree"].includes(isolation)) {
    fail2(
      `ERROR: Cannot transition '${name}': isolation must be branch or worktree, got '${isolation || "null"}'`
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
    if (!await nonempty3(path17.join(directory, artifact))) {
      fail2(
        `ERROR: Cannot transition '${name}': ${artifact} must exist and be non-empty before leaving open`
      );
    }
  }
  if (workflow === "full" && !await nonempty3(path17.join(directory, "design.md"))) {
    fail2(
      `ERROR: Cannot transition '${name}': design.md must exist and be non-empty before leaving open`
    );
  }
}
async function requireDesignEvidence(name) {
  const designDoc = await readField3(name, "design_doc");
  if (!designDoc || designDoc === "null" || !await nonempty3(path17.resolve(designDoc))) {
    fail2(
      `ERROR: Cannot transition '${name}': design_doc must point to an existing Design Doc before leaving design`
    );
  }
}
async function writeSparseTransitionEffects(directory, effects) {
  const file = path17.join(directory, ".comet.yaml");
  const document = await readDocument2(file);
  for (const effect of effects) {
    const field2 = wireField2(effect.field);
    document.set(field2, parsedValue(field2, wireValue2(effect.to)));
  }
  await atomicWrite2(file, document.toString());
}
async function applyTransitionEvent(output, name, event) {
  const { directory } = await stateFile(name);
  const projection = await readClassicState(directory);
  let classic = projection.classic;
  let sparse = false;
  if (!classic) {
    if (projection.run) fail2("ERROR: Classic state projection is missing");
    const document = await readDocument2(path17.join(directory, ".comet.yaml"));
    classic = sparseClassicState(document.toJS());
    sparse = true;
  }
  const result3 = applyClassicTransition(classic, event);
  if (projection.run) {
    await transitionClassicRuntimeRun(directory, result3.classic, projection.run, {
      event,
      source: "comet-state"
    });
  } else if (sparse) {
    await writeSparseTransitionEffects(directory, result3.effects);
  } else {
    await writeClassicState(directory, {
      classic: result3.classic,
      run: null,
      unknownKeys: projection.unknownKeys
    });
  }
  await appendClassicStateEvent(directory, {
    change: name,
    event,
    source: "comet-state",
    from: classic,
    to: result3.classic,
    effects: result3.effects
  });
  for (const effect of result3.effects) {
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
    if (!report || !await exists6(path17.resolve(report))) {
      fail2(
        `ERROR: Cannot transition '${name}': verification_report must point to an existing report file`
      );
    }
    if (await readField3(name, "branch_status") !== "handled") {
      fail2(`ERROR: Cannot transition '${name}': branch_status must be handled`);
    }
  } else if (event === "verify-fail") {
    await requirePhase(name, "verify");
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
  }
  await applyTransitionEvent(output, name, event);
}
async function next(output, name) {
  validateChangeName4(name);
  const { file, label } = await stateFile(name);
  if (!await exists6(file)) fail2(`ERROR: .comet.yaml not found at ${label}/.comet.yaml`);
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
  const file = path17.resolve(taskFile);
  if (!await exists6(file)) fail2(`ERROR: Task file not found: ${taskFile}`);
  const lines = (await fs16.readFile(file, "utf8")).split(/\r?\n/u);
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
  if (!await exists6(file)) fail2(`ERROR: .comet.yaml not found at ${label}/.comet.yaml`);
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
      (await nonempty3(path17.join(directory, artifact)) ? pass2 : reject)(
        `${artifact} ${await nonempty3(path17.join(directory, artifact)) ? "non-empty" : "missing or empty"}`
      );
    }
  } else if (phase === "build") {
    const workflow = await readField3(name, "workflow");
    const designDoc = await readField3(name, "design_doc");
    if (workflow === "full") {
      (designDoc && designDoc !== "null" && await exists6(path17.resolve(designDoc)) ? pass2 : reject)(`design_doc=${designDoc} (expected: non-null and file exists)`);
    } else {
      pass2(`workflow=${workflow} (design_doc not required)`);
    }
    for (const artifact of ["proposal.md", "tasks.md"]) {
      (await nonempty3(path17.join(directory, artifact)) ? pass2 : reject)(
        `${artifact} ${await nonempty3(path17.join(directory, artifact)) ? "non-empty" : "missing or empty"}`
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
  output.stdout.push("");
  if (blocked2) {
    output.stderr.push(red4("BLOCKED — fix failing checks before proceeding"));
    throw new CommandFailure("", 1);
  }
  output.stderr.push(green4("ALL CHECKS PASSED — ready to proceed"));
}
function fieldStatus(field2, value, file) {
  if (!value || value === "null") return `  - ${field2}: PENDING`;
  if (file && !existsSync3(path17.resolve(file))) {
    return `  - ${field2}: BROKEN (path ${value} does not exist)`;
  }
  return `  - ${field2}: DONE (${value})`;
}
async function recoverOpen(output, directory) {
  output.stdout.push("  Artifacts:");
  let complete = 0;
  for (const artifact of ["proposal.md", "design.md", "tasks.md"]) {
    const done = await nonempty3(path17.join(directory, artifact));
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
      `  - ${artifact}: ${await nonempty3(path17.join(directory, artifact)) ? "DONE" : "MISSING (unexpected in design phase)"}`
    );
  }
  const handoff = await readField3(name, "handoff_context");
  const hash = await readField3(name, "handoff_hash");
  const design = await readField3(name, "design_doc");
  output.stdout.push(
    "",
    "  Design progress:",
    fieldStatus("handoff_context", handoff, handoff),
    fieldStatus("handoff_hash", hash),
    fieldStatus("design_doc", design, design),
    ""
  );
  if (design && design !== "null" && await exists6(path17.resolve(design))) {
    output.stdout.push(
      "Recovery action: Design Doc already created and linked. Run guard to transition to build."
    );
  } else if (handoff && handoff !== "null" && await exists6(path17.resolve(handoff))) {
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
    fieldStatus("isolation", isolation),
    fieldStatus("build_mode", buildMode),
    fieldStatus("build_pause", pause),
    fieldStatus("tdd_mode", tdd),
    fieldStatus("review_mode", review)
  ];
  if (buildMode === "subagent-driven-development" || subagentDispatch && subagentDispatch !== "null") {
    decisions.push(fieldStatus("subagent_dispatch", subagentDispatch));
  }
  output.stdout.push(...decisions, "", "  Plan:", fieldStatus("plan", plan, plan), "");
  const tasks = path17.join(directory, "tasks.md");
  if (!await exists6(tasks)) {
    output.stdout.push(
      "  Tasks: tasks.md MISSING",
      "",
      "Recovery action: tasks.md missing. Verify change directory integrity."
    );
    return;
  }
  const lines = (await fs16.readFile(tasks, "utf8")).split(/\r?\n/u);
  const total = lines.filter((line) => /^\s*- \[[ xX]\] /u.test(line)).length;
  const done = lines.filter((line) => /^\s*- \[[xX]\] /u.test(line)).length;
  const pending = total - done;
  let planTotal = 0;
  let planDone = 0;
  if (plan && plan !== "null" && await exists6(path17.resolve(plan))) {
    const planLines = (await fs16.readFile(path17.resolve(plan), "utf8")).split(/\r?\n/u);
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
      return subagentDispatch === "confirmed" ? "Recovery action: Plan-ready pause is stale because build decisions are already selected. Clear build_pause to null, then inspect the first unchecked task (OpenSpec or plan additions) against recent git history/diff. If implemented, check it off; otherwise dispatch a real background subagent. Do not execute the pending task directly in the main window." : "Recovery action: Plan-ready pause is stale and subagent dispatch is not confirmed. Confirm a real background subagent/Task/multi-agent dispatcher and set subagent_dispatch to confirmed, or set build_mode to executing-plans before continuing.";
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
      return subagentDispatch === "confirmed" ? "Recovery action: Read tasks.md and the Superpowers plan (which may include additions beyond OpenSpec), then inspect the first unchecked task against recent git history/diff. If implemented, check it off; otherwise dispatch a real background subagent. Do not execute the pending task directly in the main window." : "Recovery action: Subagent dispatch is not confirmed. Confirm a real background subagent/Task/multi-agent dispatcher and set subagent_dispatch to confirmed, or set build_mode to executing-plans before continuing.";
    }
    return "Recovery action: Read tasks.md and continue from first unchecked task.";
  }
  if (planPending > 0) {
    if (buildMode === "subagent-driven-development") {
      return subagentDispatch === "confirmed" ? "Recovery action: Read the Superpowers plan, then inspect the first unchecked Superpowers plan task against recent git history/diff. If implemented, check it off; otherwise dispatch a real background subagent. Do not execute the pending task directly in the main window." : "Recovery action: Subagent dispatch is not confirmed. Confirm a real background subagent/Task/multi-agent dispatcher and set subagent_dispatch to confirmed, or set build_mode to executing-plans before continuing.";
    }
    return "Recovery action: Read the Superpowers plan and continue from the first unchecked plan task.";
  }
  return "Recovery action: All tasks done. Run guard to transition to verify.";
}
async function recoverVerify(output, name) {
  const result3 = await readField3(name, "verify_result");
  const mode = await readField3(name, "verify_mode");
  const report = await readField3(name, "verification_report");
  const branch = await readField3(name, "branch_status");
  output.stdout.push(
    "  Verification:",
    fieldStatus("verify_result", result3),
    fieldStatus("verify_mode", mode),
    fieldStatus("verification_report", report, report),
    fieldStatus("branch_status", branch),
    "",
    result3 === "pass" && branch === "handled" ? "Recovery action: Verification complete. Run guard to transition to archive." : result3 === "fail" ? "Recovery action: Verification failed and rolled back to build. Resume from /comet-build." : "Recovery action: Verification not yet started or in progress. Run scale assessment then verify."
  );
}
async function recoverArchive(output, name) {
  output.stdout.push(
    "  Archive:",
    fieldStatus("verify_result", await readField3(name, "verify_result")),
    fieldStatus("archived", await readField3(name, "archived")),
    "",
    "Recovery action: Run /comet-archive to complete archiving."
  );
}
async function recover(output, name) {
  validateChangeName4(name);
  const { file, directory, label } = await stateFile(name);
  if (!await exists6(file)) fail2(`ERROR: .comet.yaml not found at ${label}/.comet.yaml`);
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
  if (!await exists6(file)) fail2(`ERROR: .comet.yaml not found at ${label}/.comet.yaml`);
  const tasksFile = path17.join(directory, "tasks.md");
  const taskCount = await exists6(tasksFile) ? (await fs16.readFile(tasksFile, "utf8")).split(/\r?\n/u).filter((line) => /^- \[/u.test(line)).length : 0;
  const specs = path17.join(directory, "specs");
  let deltaSpecs = 0;
  if (await exists6(specs)) {
    for (const entry2 of await fs16.readdir(specs)) {
      if (await exists6(path17.join(specs, entry2, "spec.md"))) deltaSpecs += 1;
    }
  }
  const plan = await readField3(name, "plan");
  let baseRef = "";
  if (plan && plan !== "null" && await exists6(path17.resolve(plan))) {
    const match = (await fs16.readFile(path17.resolve(plan), "utf8")).match(/^base-ref:\s*(.+)$/mu);
    baseRef = match?.[1].trim() ?? "";
  }
  if (!baseRef) baseRef = await readField3(name, "base_ref");
  const changed = gitOutput([
    "diff",
    "--name-only",
    ...baseRef && baseRef !== "null" ? [`${baseRef}...HEAD`] : ["HEAD"]
  ]);
  const changedFiles = changed ? changed.split(/\r?\n/u).filter(Boolean).length : 0;
  const result3 = taskCount > 3 || deltaSpecs > 1 || changedFiles > 8 ? "full" : "light";
  await setField2(new CommandOutput(), name, "verify_mode", result3);
  output.stderr.push(
    `=== Scale Assessment: ${name} ===`,
    `  Tasks: ${taskCount} (threshold: 3)`,
    `  Delta specs: ${deltaSpecs} capabilities (threshold: 1)`,
    `  Changed files: ${changedFiles} (threshold: 8)`,
    `  → Result: ${result3}`,
    green4(`[SCALE] verify_mode=${result3}`)
  );
}
function required(args, count, usage2) {
  if (args.length < count) fail2(usage2);
}
var classicStateCommand = async (args) => {
  const output = new CommandOutput();
  try {
    const [subcommand, ...rest] = args;
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
    } else if (subcommand === "task-checkoff") {
      required(rest, 2, "Usage: comet-state.mjs task-checkoff <file> <task-text>");
      await taskCheckoff(output, rest[0], rest[1]);
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
};

// domains/comet-classic/classic-cli.ts
var CLASSIC_COMMANDS = [
  "state",
  "validate",
  "guard",
  "handoff",
  "archive",
  "hook-guard",
  "intent"
];
var DEFAULT_HANDLERS = {
  state: classicStateCommand,
  validate: classicValidateCommand,
  guard: classicGuardCommand,
  handoff: classicHandoffCommand,
  archive: classicArchiveCommand,
  "hook-guard": classicHookGuardCommand,
  intent: classicIntentCommand
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
function jsonResult(command, result3) {
  return {
    exitCode: result3.exitCode,
    stdout: JSON.stringify({
      command: command ?? null,
      exitCode: result3.exitCode,
      ...result3.stdout === void 0 ? {} : { stdout: result3.stdout },
      ...result3.stderr === void 0 ? {} : { stderr: result3.stderr }
    }) + "\n"
  };
}
async function runClassicCli(argv, handlers = DEFAULT_HANDLERS) {
  const json = argv.includes("--json");
  const args = argv.filter((argument) => argument !== "--json");
  const command = args.shift();
  const result3 = await dispatch(command, args, { json }, handlers);
  return json ? jsonResult(command, result3) : result3;
}
async function main(argv = process.argv.slice(2)) {
  const result3 = await runClassicCli(argv);
  if (result3.stdout) process.stdout.write(result3.stdout);
  if (result3.stderr)
    process.stderr.write(result3.stderr + (result3.stderr.endsWith("\n") ? "" : "\n"));
  return result3.exitCode;
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
