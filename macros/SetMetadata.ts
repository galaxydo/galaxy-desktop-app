async function SetMetadata() {
  const { text: fieldValue } = input;
  const fieldName = label.substring(1);
  return {
    ...output,
    customData: {
      ...output.customData,
      metadata: {
        [fieldName]: fieldValue,
      }
    }
  }
}
