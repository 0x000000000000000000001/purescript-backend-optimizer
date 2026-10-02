pub fn PureScript_Backend_Optimizer_CoreFn_Json_Text_parseModuleTextImpl(
    fallback: Func1<String, std::rc::Rc<Purs_Data_Either::Either>>,
    _validate: Func1<Value, std::rc::Rc<Purs_Data_Either::Either>>,
    _print_error: Func1<std::rc::Rc<Purs_Data_Argonaut_Decode_Error::JsonDecodeError>, String>,
    text: String,
) -> std::rc::Rc<Purs_Data_Either::Either> { fallback(text) }
