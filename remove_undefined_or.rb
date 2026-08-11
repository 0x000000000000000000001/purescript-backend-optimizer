content = File.read("src/PureScript/Backend/Optimizer/Semantics/Foreign.purs")

content.gsub!(/    , test_data_undefinedOr_compareUndefinedOrImpl\n/, "")
content.gsub!(/    , test_data_undefinedOr_defined\n/, "")
content.gsub!(/    , test_data_undefinedOr_eqUndefinedOrImpl\n/, "")
content.gsub!(/    , test_data_undefinedOr_undefined\n/, "")

content.gsub!(/^test_data_undefinedOr_undefined :: ForeignSemantics$.*?^test_data_undefinedOr_defined ::/m, "test_data_undefinedOr_defined ::")
content.gsub!(/^test_data_undefinedOr_defined :: ForeignSemantics$.*?^test_data_undefinedOr_eqUndefinedOrImpl ::/m, "test_data_undefinedOr_eqUndefinedOrImpl ::")
content.gsub!(/^test_data_undefinedOr_eqUndefinedOrImpl :: ForeignSemantics$.*?^test_data_undefinedOr_compareUndefinedOrImpl ::/m, "test_data_undefinedOr_compareUndefinedOrImpl ::")
content.gsub!(/^test_data_undefinedOr_compareUndefinedOrImpl :: ForeignSemantics$.*?^unsafe_coerce_unsafeCoerce ::/m, "unsafe_coerce_unsafeCoerce ::")

File.write("src/PureScript/Backend/Optimizer/Semantics/Foreign.purs", content)
