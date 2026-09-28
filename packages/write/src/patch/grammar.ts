/**
 * The Codex apply_patch grammar in Lark, as Codex sends it with its freeform
 * apply_patch tool (codex-rs/core, apply_patch.lark, Apache-2.0). Hosts that
 * support grammar tools constrain the model's patch text with it.
 * `*** Environment ID:` is not in it, and the parser refuses that line.
 */
export const CODEX_PATCH_GRAMMAR = `start: begin_patch hunk+ end_patch
begin_patch: "*** Begin Patch" LF
end_patch: "*** End Patch" LF?

hunk: add_hunk | delete_hunk | update_hunk
add_hunk: "*** Add File: " filename LF add_line+
delete_hunk: "*** Delete File: " filename LF
update_hunk: "*** Update File: " filename LF change_move? change?

filename: /(.+)/
add_line: "+" /(.*)/ LF -> line

change_move: "*** Move to: " filename LF
change: (change_context | change_line)+ eof_line?
change_context: ("@@" | "@@ " /(.+)/) LF
change_line: ("+" | "-" | " ") /(.*)/ LF
eof_line: "*** End of File" LF

%import common.LF
`;
