/** 旧内容证明协议已撤下；历史记录由原 Run 保留。 */
export async function runClassicEditReviewCommand(_options: unknown): Promise<never> {
  throw new Error(
    'Native/Classic 内容证明协议已移除。由当前 Agent 判断实际修改，使用原 workflow 的继续、修订或检查入口；无需 observe、record 或指纹。',
  );
}
