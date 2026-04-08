export type BlingOrder = {
  id: string;
  numero?: string;
  data?: string;
  clienteNome?: string;
  valorTotal?: number;
  situacao?: string | number;
  situacaoId?: number;
  observacoes?: string;
  itens?: Array<{
    descricao: string;
    quantidade: number;
    valorUnitario?: number;
    valorTotal?: number;
  }>;
};

export type TrelloCardPayload = {
  name: string;
  desc: string;
};
