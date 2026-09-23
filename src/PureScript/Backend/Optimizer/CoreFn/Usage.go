package PureScript_Backend_Optimizer_CoreFn_Usage

// Native Go implementation of validateSourceUsageModule: the same traversal of
// the decoded module, the same scope/seen bookkeeping and the same first
// failure as the PureScript implementation, without StateT, Map/Set or
// Maybe/Either plumbing. The PureScript fallback argument is only used by the
// JavaScript backend.

import (
	"strconv"
	"unsafe"

	"gopurs/output/gopurs_runtime"
)

// Constructor tags mirror the generated accessors.
const (
	vsTagJust            = 930809136
	vsTagLeft            = 3711209382
	vsTagRight           = 2465973597
	vsTagTypeMismatch    = 2887704423
	vsTagImport          = 2024897590
	vsTagNonRec          = 776125136
	vsTagRec             = 2111926015
	vsTagBinding         = 74370570
	vsTagExprVar         = 2055675025
	vsTagExprLit         = 232770309
	vsTagExprConstructor = 697214492
	vsTagExprAccessor    = 3638357773
	vsTagExprUpdate      = 2514985317
	vsTagExprAbs         = 2721098116
	vsTagExprApp         = 519619125
	vsTagExprCase        = 2509734720
	vsTagExprLet         = 2588226569
	vsTagExprTypeApp     = 3654600589
	vsTagCaseAlternative = 4007425008
	vsTagUnconditional   = 2417754510
	vsTagGuarded         = 1315856655
	vsTagBinderNull      = 3395565766
	vsTagBinderVar       = 1586641112
	vsTagBinderNamed     = 1365461886
	vsTagBinderCons      = 1517657301
	vsTagBinderLit       = 1587391820
	vsTagLitArray        = 2075623491
	vsTagLitRecord       = 3197411319
)

// A scope entry is nil for an unannotated local (which still hides an outer
// annotated variable of the same name) and non-nil for a known identity.
type vsIdentity struct {
	moduleName string
	bindingID  int64
}

type vsScope map[string]*vsIdentity

type vsChecker struct {
	moduleName string
	seen       map[string]bool
}

type vsFailure struct {
	err gopurs_runtime.Value
}

func (c *vsChecker) fail(message string) {
	panic(vsFailure{err: vsTypeMismatch(message)})
}

func vsTypeMismatch(message string) gopurs_runtime.Value {
	return gopurs_runtime.Value{Type: 9, IntVal: vsTagTypeMismatch, UnsafePtr: unsafe.Pointer(&Constructor_Data_Argonaut_Decode_Error_TypeMismatch{1, message})}
}

func vsLeft(err gopurs_runtime.Value) gopurs_runtime.Value {
	return gopurs_runtime.Value{Type: 9, IntVal: vsTagLeft, UnsafePtr: unsafe.Pointer(&Constructor_Data_Either_Left[gopurs_runtime.Value, gopurs_runtime.Value]{1, err})}
}

func vsRight(value gopurs_runtime.Value) gopurs_runtime.Value {
	return gopurs_runtime.Value{Type: 9, IntVal: vsTagRight, UnsafePtr: unsafe.Pointer(&Constructor_Data_Either_Right[gopurs_runtime.Value, gopurs_runtime.Value]{1, value})}
}

func vsIsJust(value gopurs_runtime.Value) bool {
	return value.Type == 9 && value.IntVal == vsTagJust && value.UnsafePtr != nil
}

func vsFromJust(value gopurs_runtime.Value) gopurs_runtime.Value {
	return (*Constructor_Data_Maybe_Just[gopurs_runtime.Value])(value.UnsafePtr).V0
}

func vsArray(value gopurs_runtime.Value) []gopurs_runtime.Value {
	if value.Type == gopurs_runtime.TypeArray && value.UnsafePtr != nil {
		return *(*[]gopurs_runtime.Value)(value.UnsafePtr)
	}
	return nil
}

var vsEmptyUsageValue = gopurs_runtime.RecordDict2("bindingUsage", "variableUse",
	gopurs_runtime.Value{Type: 9, IntVal: vsTagJust},
	gopurs_runtime.Value{Type: 9, IntVal: vsTagJust})

func vsEmptyUsage() gopurs_runtime.Value {
	return vsEmptyUsageValue
}

// usage: the annotation's sourceUsage facts, defaulting to empty.
func vsUsage(ann gopurs_runtime.Value) gopurs_runtime.Value {
	sourceUsage := gopurs_runtime.RecordGet(ann, "sourceUsage")
	if vsIsJust(sourceUsage) {
		return vsFromJust(sourceUsage)
	}
	return vsEmptyUsage()
}

func (c *vsChecker) plain(ann gopurs_runtime.Value) {
	info := vsUsage(ann)
	if !vsIsJust(gopurs_runtime.RecordGet(info, "bindingUsage")) && !vsIsJust(gopurs_runtime.RecordGet(info, "variableUse")) {
		return
	}
	c.fail("source usage facts on a nonlocal annotation")
}

// register returns the scope extended with ident. Scopes are copied because
// PureScript scopes are persistent maps.
func (c *vsChecker) register(moduleName string, scope vsScope, ann gopurs_runtime.Value, ident string) vsScope {
	info := vsUsage(ann)
	if vsIsJust(gopurs_runtime.RecordGet(info, "variableUse")) {
		c.fail("variableUse on a binding annotation")
	}
	next := make(vsScope, len(scope)+1)
	for key, value := range scope {
		next[key] = value
	}
	if bindingUsage := gopurs_runtime.RecordGet(info, "bindingUsage"); vsIsJust(bindingUsage) {
		identity := gopurs_runtime.RecordGet(vsFromJust(bindingUsage), "binding")
		bindingID := gopurs_runtime.RecordGet(identity, "bindingId").IntVal
		origin := gopurs_runtime.RecordGet(identity, "moduleName").StrVal()
		if origin != moduleName {
			c.fail("source binding from another module")
		}
		key := origin + "#" + strconv.FormatInt(bindingID, 10)
		if c.seen[key] {
			c.fail("duplicate source bindingId")
		}
		c.seen[key] = true
		next[ident] = &vsIdentity{moduleName: origin, bindingID: bindingID}
	} else {
		next[ident] = nil
	}
	return next
}

func (c *vsChecker) bindings(moduleName string, scope vsScope, group []gopurs_runtime.Value) vsScope {
	for _, item := range group {
		switch item.IntVal {
		case vsTagNonRec:
			binding := (*Constructor_PureScript_Backend_Optimizer_CoreFn_NonRec[gopurs_runtime.Value])(item.UnsafePtr).V0
			c.expression(moduleName, scope, binding.V2)
			scope = c.register(moduleName, scope, binding.V0, binding.V1)
		case vsTagRec:
			groupBindings := (*Constructor_PureScript_Backend_Optimizer_CoreFn_Rec[gopurs_runtime.Value])(item.UnsafePtr).V0
			recScope := scope
			for _, binding := range groupBindings {
				recScope = c.register(moduleName, recScope, binding.V0, binding.V1)
			}
			for _, binding := range groupBindings {
				c.expression(moduleName, recScope, binding.V2)
			}
			scope = recScope
		default:
			c.fail("Bind")
		}
	}
	return scope
}

func (c *vsChecker) expression(moduleName string, scope vsScope, expr gopurs_runtime.Value) {
	switch expr.IntVal {
	case vsTagExprVar:
		value := (*Constructor_PureScript_Backend_Optimizer_CoreFn_ExprVar[gopurs_runtime.Value])(expr.UnsafePtr)
		info := vsUsage(value.V0)
		if vsIsJust(gopurs_runtime.RecordGet(info, "bindingUsage")) {
			c.fail("bindingUsage on a variable occurrence")
		}
		if variableUse := gopurs_runtime.RecordGet(info, "variableUse"); vsIsJust(variableUse) {
			use := vsFromJust(variableUse)
			qualified := value.V1
			var target *vsIdentity
			if qualified.V0 == nil {
				target = scope[qualified.V1]
			}
			expected := gopurs_runtime.RecordGet(use, "binding")
			if target == nil || target.moduleName != gopurs_runtime.RecordGet(expected, "moduleName").StrVal() || target.bindingID != gopurs_runtime.RecordGet(expected, "bindingId").IntVal {
				c.fail("variableUse outside its lexical binding")
			}
		}
	case vsTagExprLit:
		value := (*Constructor_PureScript_Backend_Optimizer_CoreFn_ExprLit[gopurs_runtime.Value])(expr.UnsafePtr)
		c.plain(value.V0)
		for _, item := range vsLiteralValues(value.V1) {
			c.expression(moduleName, scope, item)
		}
	case vsTagExprConstructor:
		value := (*Constructor_PureScript_Backend_Optimizer_CoreFn_ExprConstructor[gopurs_runtime.Value])(expr.UnsafePtr)
		c.plain(value.V0)
	case vsTagExprAccessor:
		value := (*Constructor_PureScript_Backend_Optimizer_CoreFn_ExprAccessor[gopurs_runtime.Value])(expr.UnsafePtr)
		c.plain(value.V0)
		c.expression(moduleName, scope, value.V1)
	case vsTagExprUpdate:
		value := (*Constructor_PureScript_Backend_Optimizer_CoreFn_ExprUpdate[gopurs_runtime.Value])(expr.UnsafePtr)
		c.plain(value.V0)
		c.expression(moduleName, scope, value.V1)
		for _, prop := range value.V2 {
			c.expression(moduleName, scope, prop.V1)
		}
	case vsTagExprAbs:
		value := (*Constructor_PureScript_Backend_Optimizer_CoreFn_ExprAbs[gopurs_runtime.Value])(expr.UnsafePtr)
		inner := c.register(moduleName, scope, value.V0, value.V1)
		c.expression(moduleName, inner, value.V2)
	case vsTagExprApp:
		value := (*Constructor_PureScript_Backend_Optimizer_CoreFn_ExprApp[gopurs_runtime.Value])(expr.UnsafePtr)
		c.plain(value.V0)
		c.expression(moduleName, scope, value.V1)
		c.expression(moduleName, scope, value.V2)
	case vsTagExprCase:
		value := (*Constructor_PureScript_Backend_Optimizer_CoreFn_ExprCase[gopurs_runtime.Value])(expr.UnsafePtr)
		c.plain(value.V0)
		for _, item := range value.V1 {
			c.expression(moduleName, scope, item)
		}
		for _, item := range value.V2 {
			c.alternative(moduleName, scope, item)
		}
	case vsTagExprLet:
		value := (*Constructor_PureScript_Backend_Optimizer_CoreFn_ExprLet[gopurs_runtime.Value])(expr.UnsafePtr)
		c.plain(value.V0)
		inner := c.bindings(moduleName, scope, value.V1)
		c.expression(moduleName, inner, value.V2)
	case vsTagExprTypeApp:
		value := (*Constructor_PureScript_Backend_Optimizer_CoreFn_ExprTypeApp[gopurs_runtime.Value])(expr.UnsafePtr)
		c.plain(value.V0)
		c.expression(moduleName, scope, value.V1)
	default:
		c.fail("Expr")
	}
}

func (c *vsChecker) alternative(moduleName string, scope vsScope, alternative *Constructor_PureScript_Backend_Optimizer_CoreFn_CaseAlternative[gopurs_runtime.Value]) {
	inner := scope
	for _, binder := range alternative.V0 {
		inner = c.binder(moduleName, inner, binder)
	}
	result := alternative.V1
	switch result.IntVal {
	case vsTagUnconditional:
		guard := (*Constructor_PureScript_Backend_Optimizer_CoreFn_Unconditional[gopurs_runtime.Value])(result.UnsafePtr)
		c.expression(moduleName, inner, guard.V0)
	case vsTagGuarded:
		guarded := (*Constructor_PureScript_Backend_Optimizer_CoreFn_Guarded[gopurs_runtime.Value])(result.UnsafePtr)
		for _, item := range guarded.V0 {
			c.expression(moduleName, inner, item.V0)
			c.expression(moduleName, inner, item.V1)
		}
	default:
		c.fail("CaseGuard")
	}
}

func (c *vsChecker) binder(moduleName string, scope vsScope, binderValue gopurs_runtime.Value) vsScope {
	switch binderValue.IntVal {
	case vsTagBinderNull:
		value := (*Constructor_PureScript_Backend_Optimizer_CoreFn_BinderNull[gopurs_runtime.Value])(binderValue.UnsafePtr)
		c.plain(value.V0)
		return scope
	case vsTagBinderVar:
		value := (*Constructor_PureScript_Backend_Optimizer_CoreFn_BinderVar[gopurs_runtime.Value])(binderValue.UnsafePtr)
		return c.register(moduleName, scope, value.V0, value.V1)
	case vsTagBinderNamed:
		value := (*Constructor_PureScript_Backend_Optimizer_CoreFn_BinderNamed[gopurs_runtime.Value])(binderValue.UnsafePtr)
		inner := c.register(moduleName, scope, value.V0, value.V1)
		return c.binder(moduleName, inner, value.V2)
	case vsTagBinderCons:
		value := (*Constructor_PureScript_Backend_Optimizer_CoreFn_BinderConstructor[gopurs_runtime.Value])(binderValue.UnsafePtr)
		c.plain(value.V0)
		inner := scope
		for _, item := range value.V3 {
			inner = c.binder(moduleName, inner, item)
		}
		return inner
	case vsTagBinderLit:
		value := (*Constructor_PureScript_Backend_Optimizer_CoreFn_BinderLit[gopurs_runtime.Value])(binderValue.UnsafePtr)
		c.plain(value.V0)
		inner := scope
		for _, item := range vsLiteralValues(value.V1) {
			inner = c.binder(moduleName, inner, item)
		}
		return inner
	default:
		c.fail("Binder")
		return scope
	}
}

func vsLiteralValues(literal gopurs_runtime.Value) []gopurs_runtime.Value {
	switch literal.IntVal {
	case vsTagLitArray:
		value := (*Constructor_PureScript_Backend_Optimizer_CoreFn_LitArray[gopurs_runtime.Value])(literal.UnsafePtr)
		return value.V0
	case vsTagLitRecord:
		value := (*Constructor_PureScript_Backend_Optimizer_CoreFn_LitRecord[gopurs_runtime.Value])(literal.UnsafePtr)
		out := make([]gopurs_runtime.Value, len(value.V0))
		for i, prop := range value.V0 {
			out[i] = prop.V1
		}
		return out
	}
	return nil
}

func (c *vsChecker) top(bind gopurs_runtime.Value) {
	switch bind.IntVal {
	case vsTagNonRec:
		c.topBinding((*Constructor_PureScript_Backend_Optimizer_CoreFn_NonRec[gopurs_runtime.Value])(bind.UnsafePtr).V0)
	case vsTagRec:
		for _, binding := range (*Constructor_PureScript_Backend_Optimizer_CoreFn_Rec[gopurs_runtime.Value])(bind.UnsafePtr).V0 {
			c.topBinding(binding)
		}
	default:
		c.fail("Bind")
	}
}

func (c *vsChecker) topBinding(binding *Constructor_PureScript_Backend_Optimizer_CoreFn_Binding[gopurs_runtime.Value]) {
	c.plain(binding.V0)
	c.expression(c.moduleName, vsScope{}, binding.V2)
}

// ValidateSourceUsageModuleImpl mirrors Usage.validateSourceUsageModule.
func ValidateSourceUsageModuleImpl(fallback gopurs_runtime.Value, moduleValue gopurs_runtime.Value) (result gopurs_runtime.Value) {
	_ = fallback
	defer func() {
		if recovered := recover(); recovered != nil {
			if failure, ok := recovered.(vsFailure); ok {
				result = vsLeft(failure.err)
				return
			}
			panic(recovered)
		}
	}()
	name := gopurs_runtime.RecordGet(moduleValue, "name").StrVal()
	checker := &vsChecker{moduleName: name, seen: map[string]bool{}}
	for _, importValue := range vsArray(gopurs_runtime.RecordGet(moduleValue, "imports")) {
		imported := (*Constructor_PureScript_Backend_Optimizer_CoreFn_Import[gopurs_runtime.Value])(importValue.UnsafePtr)
		checker.plain(imported.V0)
	}
	for _, bind := range vsArray(gopurs_runtime.RecordGet(moduleValue, "decls")) {
		checker.top(bind)
	}
	return vsRight(Get_Data_Unit_unit())
}
