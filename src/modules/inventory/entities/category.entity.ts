import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';
import { ArticleType } from '../enums/category.enums';
import { ProductEntity } from './product.entity';

@Entity({ schema: 'inv', name: 'categories' })
export class CategoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'article_type', type: 'enum', enum: ArticleType })
  articleType: ArticleType;

  /** Solo prellena el formulario de creación de producto; no gobierna nada automáticamente. */
  @Column({ name: 'default_requires_serial', type: 'boolean', default: true })
  defaultRequiresSerial: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @OneToMany(() => ProductEntity, (product) => product.category)
  products?: ProductEntity[];
}
